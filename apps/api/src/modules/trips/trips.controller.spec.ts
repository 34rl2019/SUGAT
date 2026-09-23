import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { StartDto, TripsController } from './trips.controller';
const ids = {routeId:'00000000-0000-4000-8000-000000000001',vehicleId:'00000000-0000-4000-8000-000000000002',startStopId:'00000000-0000-4000-8000-000000000003',destinationStopId:'00000000-0000-4000-8000-000000000004'};
const pipe=new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true});
const validate=(body:unknown)=>pipe.transform(body,{type:'body',metatype:StartDto});
it('validates and forwards all four start selections',async()=>{
 const service:any={startAutonomous:jest.fn()};const dto=await validate(ids);
 new TripsController(service).startAutonomous({sub:'user',role:'DRIVER'},dto);
 expect(service.startAutonomous).toHaveBeenCalledWith('user',ids.routeId,ids.vehicleId,ids.startStopId,ids.destinationStopId);
});
it.each(['routeId','startStopId','destinationStopId'])('rejects missing %s before service execution',async(key)=>{
 const body:any={...ids};delete body[key];await expect(validate(body)).rejects.toBeInstanceOf(BadRequestException);
});
it.each(Object.keys(ids))('rejects malformed %s',async(key)=>{await expect(validate({...ids,[key]:'invalid'})).rejects.toBeInstanceOf(BadRequestException)});
