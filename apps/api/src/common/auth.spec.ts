import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { JwtGuard } from './auth';

describe('JwtGuard temporary-password policy',()=>{
  function context(){const request:any={headers:{authorization:'Bearer token'}};return{switchToHttp:()=>({getRequest:()=>request}),getHandler:()=>function handler(){},getClass:()=>class Controller{}}as any}
  const jwt:any={verifyAsync:jest.fn().mockResolvedValue({sub:'user-1',role:Role.ADMIN})};
  const reflector=new Reflector();

  it('does not block an administrator if a stale mustChangePassword flag is present',async()=>{
    const db:any={user:{findUnique:jest.fn().mockResolvedValue({role:Role.ADMIN,accountStatus:'ACTIVE',mustChangePassword:true})}};
    await expect(new JwtGuard(jwt,reflector,db).canActivate(context())).resolves.toBe(true);
  });

  it('continues to restrict driver operations until the temporary password is changed',async()=>{
    const driverJwt:any={verifyAsync:jest.fn().mockResolvedValue({sub:'user-1',role:Role.DRIVER})};
    const db:any={user:{findUnique:jest.fn().mockResolvedValue({role:Role.DRIVER,accountStatus:'ACTIVE',mustChangePassword:true})}};
    await expect(new JwtGuard(driverJwt,reflector,db).canActivate(context())).rejects.toBeInstanceOf(ForbiddenException);
  });
});
