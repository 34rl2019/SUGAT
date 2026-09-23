import { BadRequestException, ConflictException } from '@nestjs/common';
import { AdminService } from './admin.service';

describe('Admin route authorization',()=>{
 function setup(){const db:any={driver:{findUnique:jest.fn().mockResolvedValue({id:'driver'})},route:{count:jest.fn().mockResolvedValue(2)},trip:{findFirst:jest.fn().mockResolvedValue(null)},driverRouteAuthorization:{deleteMany:jest.fn(),createMany:jest.fn()},auditLog:{create:jest.fn()},$transaction:jest.fn(async cb=>cb(db))};return{db,service:new AdminService(db,{}as any,{}as any)}}
 it('authorizes registered active route/directions without creating a schedule or trip',async()=>{const{service,db}=setup();expect(await service.authorizeRoutes('admin','driver',['outbound','inbound'])).toEqual({routeIds:['outbound','inbound']});expect(db.driverRouteAuthorization.createMany).toHaveBeenCalledWith({data:[{driverId:'driver',routeId:'outbound'},{driverId:'driver',routeId:'inbound'}]});expect(db.auditLog.create).toHaveBeenCalled()});
 it('rejects unknown/inactive routes without removing previous grants',async()=>{const{service,db}=setup();db.route.count.mockResolvedValue(1);await expect(service.authorizeRoutes('admin','driver',['valid','invalid'])).rejects.toBeInstanceOf(BadRequestException);expect(db.driverRouteAuthorization.deleteMany).not.toHaveBeenCalled()});
 it('preserves active route authorization until the trip ends',async()=>{const{service,db}=setup();db.route.count.mockResolvedValue(1);db.trip.findFirst.mockResolvedValue({routeId:'active-route'});await expect(service.authorizeRoutes('admin','driver',['other-route'])).rejects.toBeInstanceOf(ConflictException);expect(db.driverRouteAuthorization.deleteMany).not.toHaveBeenCalled()});
});
