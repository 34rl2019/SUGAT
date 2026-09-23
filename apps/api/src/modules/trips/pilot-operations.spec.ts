import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TripsService } from './trips.service';
import { DriverComplianceService } from '../../common/driver-compliance.service';

describe('autonomous driver operations', () => {
  function setup() {
    const now = new Date();
    const driver = { id: 'driver', userId: 'user', active: true, user: { accountStatus: 'ACTIVE' }, licenseNumber: 'LICENSE', licenseExpiresAt: new Date(now.getTime()+86400000), identityVerificationStatus: 'APPROVED', licenseVerificationStatus: 'APPROVED' };
    let active: any = null;
    const db: any = {
      driver: { findUnique: jest.fn(async()=>driver) },
      route: { findUnique: jest.fn(async()=>({id:'route',active:true,stops:['a','b','c','d'].map((stopId,i)=>({stopId,sequence:i+1,boardingAllowed:true,dropoffAllowed:true,stop:{active:true}}))})) },
      vehicle: { findMany: jest.fn(async()=>[{id:'vehicle',capacity:15}]) },
      trip: {
        findFirst: jest.fn(async()=>active), findUnique: jest.fn(async()=>active), findUniqueOrThrow: jest.fn(async()=>active),
        create: jest.fn(async({data})=>{if(active)throw new Prisma.PrismaClientKnownRequestError('duplicate',{code:'P2002',clientVersion:'test'});return active={id:'trip',...data};}),
        updateMany: jest.fn(async({where,data})=>{if(!active||active.id!==where.id||active.status!==where.status||(where.driverId&&active.driverId!==where.driverId))return{count:0};Object.assign(active,data);return{count:1};}),
      },
      auditLog:{create:jest.fn()},tripEvent:{create:jest.fn()},vehicleCurrentLocation:{deleteMany:jest.fn()},
      $transaction:jest.fn(async(cb)=>cb(db)),
    };
    const live:any={publishStarted:jest.fn(),publishOccupancy:jest.fn(),publishEnded:jest.fn()};
    const service=new TripsService(db,live,new DriverComplianceService(),{now:()=>now} as any);
    return{service,db,live,now,driver};
  }
  it('starts without a schedule/READY trip, using the assigned vehicle, actual time and VACANT',async()=>{
    const{service,db,live,now}=setup();const trip=await service.startAutonomous('user','route',undefined,'b','c');
    expect(trip).toMatchObject({driverId:'driver',vehicleId:'vehicle',routeId:'route',startedAt:now,status:'ACTIVE',occupancyStatus:'VACANT'});
    expect(trip.scheduledDepartureAt).toBeUndefined();expect(trip.scheduleId).toBeUndefined();
    expect(db.vehicle.findMany).toHaveBeenCalledWith({where:{assignedDriverId:'driver',active:true}});
    expect(live.publishStarted).toHaveBeenCalledWith('trip');
  });
  it('rejects invalid vehicle associations before creating a trip',async()=>{
    const{service,db}=setup();
    db.vehicle.findMany.mockResolvedValue([]);
    await expect(service.startAutonomous('user','route','other-vehicle','b','c')).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.trip.create).not.toHaveBeenCalled();
  });
  it('preserves driver compliance checks',async()=>{const{service,driver}=setup();driver.licenseExpiresAt=new Date(0);await expect(service.startAutonomous('user','route',undefined,'b','c')).rejects.toBeInstanceOf(ForbiddenException)});
  it('rejects another start/route switch during an active trip',async()=>{const{service}=setup();await service.startAutonomous('user','route',undefined,'b','c');await expect(service.startAutonomous('user','other-route',undefined,'b','c')).rejects.toBeInstanceOf(ConflictException)});
  it('translates concurrent driver/vehicle uniqueness failures into a conflict',async()=>{
    const{service,db,live}=setup();db.trip.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('duplicate',{code:'P2002',clientVersion:'test'}));
    await expect(service.startAutonomous('user','route',undefined,'b','c')).rejects.toBeInstanceOf(ConflictException);expect(live.publishStarted).not.toHaveBeenCalled();
  });
  it('persists FULL then VACANT, broadcasts identity, and leaves the trip active and capacity unchanged',async()=>{
    const{service,db,live}=setup();await service.startAutonomous('user','route',undefined,'b','c');
    for(const occupancyStatus of ['FULL','VACANT'] as const){expect(await service.setOccupancy('user','trip',occupancyStatus)).toMatchObject({tripId:'trip',vehicleId:'vehicle',occupancyStatus,updatedAt:expect.any(Date)});expect(await db.trip.findUnique()).toMatchObject({status:'ACTIVE',occupancyStatus});}
    expect(live.publishOccupancy).toHaveBeenCalledTimes(2);expect((await db.vehicle.findMany())[0].capacity).toBe(15);
    expect(db.vehicleCurrentLocation.deleteMany).not.toHaveBeenCalled();
  });
  it('rejects another driver occupancy/end operations and rejects occupancy after end',async()=>{
    const{service,driver}=setup();await service.startAutonomous('user','route',undefined,'b','c');driver.id='other';
    await expect(service.setOccupancy('other','trip','FULL')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.complete('other','trip')).rejects.toBeInstanceOf(ForbiddenException);
    driver.id='driver';await service.complete('user','trip');
    await expect(service.setOccupancy('user','trip','FULL')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.complete('user','trip')).rejects.toBeInstanceOf(ConflictException);
  });
  it('ends, releases availability, and emits completion',async()=>{const{service,db,live}=setup();await service.startAutonomous('user','route',undefined,'b','c');expect(await service.complete('user','trip')).toMatchObject({status:'COMPLETED',endedAt:expect.any(Date)});expect(db.vehicleCurrentLocation.deleteMany).toHaveBeenCalledWith({where:{tripId:'trip'}});expect(live.publishEnded).toHaveBeenCalledWith('trip')});
  it('stores the selected segment and initializes progression at its first stop',async()=>{
    const {service,db}=setup();
    expect(await service.startAutonomous('user','route','vehicle','b','c')).toMatchObject({lastPassedSequence:1});
    expect(db.tripEvent.create).toHaveBeenCalledWith({data:{tripId:'trip',type:'STARTED',metadata:{startStopId:'b',destinationStopId:'c'}}});
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function),{isolationLevel:'Serializable'});
  });
  it.each([[undefined,'c'],['b',undefined],['b','b'],['c','b'],['foreign','c'],['b','foreign']])('rejects invalid endpoints %s -> %s',async(start,end)=>{
    const {service,db}=setup();await expect(service.startAutonomous('user','route','vehicle',start,end)).rejects.toBeInstanceOf(BadRequestException);expect(db.trip.create).not.toHaveBeenCalled();
  });
  it.each(['inactive route','inactive start','inactive destination','boarding disabled','dropoff disabled'])('rejects %s',async(reason)=>{
    const {service,db}=setup();const route=await db.route.findUnique();
    if(reason==='inactive route')route.active=false;
    if(reason==='inactive start')route.stops[1].stop.active=false;
    if(reason==='inactive destination')route.stops[2].stop.active=false;
    if(reason==='boarding disabled')route.stops[1].boardingAllowed=false;
    if(reason==='dropoff disabled')route.stops[2].dropoffAllowed=false;
    db.route.findUnique.mockResolvedValue(route);
    await expect(service.startAutonomous('user','route','vehicle','b','c')).rejects.toMatchObject({status:reason==='inactive route'?403:400});
    expect(db.trip.create).not.toHaveBeenCalled();
  });
  it('lists all active routes and assigned active vehicles',async()=>{
    const {service,db}=setup();db.route.findMany=jest.fn().mockResolvedValue([]);db.stop={findMany:jest.fn().mockResolvedValue([])};
    await service.operations('user');
    expect(db.route.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{active:true}}));
    expect(db.vehicle.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{assignedDriverId:'driver',active:true}}));
  });

});
