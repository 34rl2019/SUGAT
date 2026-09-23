import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import argon2 from 'argon2';
import { AuthService } from './auth.service';
import { AdminService } from '../admin/admin.service';
import { JwtGuard } from '../../common/auth';
import { TripsController } from '../trips/trips.controller';

describe('persistent driver device authorization and reset',()=>{
  afterEach(()=>jest.restoreAllMocks());
  function setup(){
    jest.spyOn(argon2,'hash').mockImplementation(async(value)=>'hash:'+String(value) as never);
    jest.spyOn(argon2,'verify').mockImplementation(async(hash,value)=>hash==='hash:'+String(value));
    const user={id:'user',email:'driver@example.test',role:'DRIVER',passwordHash:'hash:password',accountStatus:'ACTIVE',mustChangePassword:false};
    const driver={id:'driver',userId:'user',active:true};let device:any=null;const sessions=new Map<string,any>();
    const db:any={
      user:{findUnique:jest.fn(async()=>user)},
      driver:{findUnique:jest.fn(async()=>({...driver,authorizedDevice:device}))},
      driverDevice:{create:jest.fn(async({data})=>(device={id:'device-'+Math.random(),...data,driver})),findUnique:jest.fn(async({where})=>device?.id===where.id?device:null),deleteMany:jest.fn(async()=>{device=null;return{count:1}})},
      refreshSession:{create:jest.fn(async({data})=>{const session={...data,user,revokedAt:null};sessions.set(data.id,session);return session}),findUnique:jest.fn(async({where})=>sessions.get(where.id)),updateMany:jest.fn(async({where,data})=>{let count=0;for(const session of sessions.values())if((!where.id||session.id===where.id)&&(!where.userId||session.userId===where.userId)&&!session.revokedAt){Object.assign(session,data);count++}return{count}})},
      auditLog:{create:jest.fn()},$transaction:jest.fn(async(cb)=>cb(db)),
    };
    const jwt:any={signAsync:jest.fn(async payload=>Buffer.from(JSON.stringify(payload)).toString('base64url')),verifyAsync:jest.fn(async token=>JSON.parse(Buffer.from(token,'base64url').toString()))};
    const auth=new AuthService(db,jwt),admin=new AdminService(db,{} as any,{} as any),guard=new JwtGuard(jwt,new Reflector(),db);
    const login=(deviceCredential?:string)=>auth.login({email:user.email,password:'password',deviceCredential});
    const authorize=(accessToken:string,deviceCredential:string,method:keyof TripsController='startAutonomous')=>guard.canActivate({switchToHttp:()=>({getRequest:()=>({headers:{authorization:'Bearer '+accessToken,'x-sugat-device-credential':deviceCredential}})}),getHandler:()=>TripsController.prototype[method],getClass:()=>TripsController}as any);
    return{auth,admin,db,login,authorize};
  }
  it('binds first login, stores only a hash, and accepts subsequent use of the same credential',async()=>{
    const{login,authorize,db}=setup();const first=await login();expect(first.deviceCredential).toMatch(/^[a-f0-9]{64}$/);
    expect(db.driverDevice.create.mock.calls[0][0].data.credentialHash).not.toBe(first.deviceCredential);
    expect(await authorize(first.accessToken,first.deviceCredential!)).toBe(true);
    const same=await login(first.deviceCredential);expect(same.deviceCredential).toBeUndefined();expect(await authorize(same.accessToken,first.deviceCredential!)).toBe(true);
  });
  it('rejects a different device even with the password, and rejects refresh without its credential',async()=>{
    const{login,auth}=setup();const first=await login();await expect(login()).rejects.toBeInstanceOf(ForbiddenException);await expect(login('a'.repeat(64))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(auth.refresh(first.refreshToken,'b'.repeat(64))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(auth.refresh(first.refreshToken,first.deviceCredential)).resolves.toHaveProperty('accessToken');
  });
  it('logout revokes the session without releasing the device',async()=>{
    const{login,auth,authorize}=setup();const first=await login();await auth.logout('user',first.refreshToken);
    await expect(authorize(first.accessToken,first.deviceCredential!)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(login()).rejects.toBeInstanceOf(ForbiddenException);await expect(login(first.deviceCredential)).resolves.toHaveProperty('accessToken');
  });
  it('Admin reset blocks old START/END/FULL/VACANT/GPS sessions and allows a new device',async()=>{
    const{login,admin,auth,authorize,db}=setup();const first=await login();await admin.resetDevice('admin','driver');
    for(const method of ['startAutonomous','start','complete','occupancy','location','batch','operations','assignment']as const)await expect(authorize(first.accessToken,first.deviceCredential!,method)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(auth.refresh(first.refreshToken,first.deviceCredential)).rejects.toBeInstanceOf(UnauthorizedException);
    const next=await login();expect(next.deviceCredential).not.toBe(first.deviceCredential);expect(await authorize(next.accessToken,next.deviceCredential!)).toBe(true);
    await expect(authorize(next.accessToken,first.deviceCredential!)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(db.auditLog.create).toHaveBeenCalledWith({data:{actorId:'admin',action:'driver.device.reset',entityType:'Driver',entityId:'driver'}});
  });
});
