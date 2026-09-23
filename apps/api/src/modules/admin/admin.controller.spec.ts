import 'reflect-metadata';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { AdminController } from './admin.controller';
it('does not expose Admin schedule creation while retaining history',()=>{
 const handlers=Object.getOwnPropertyNames(AdminController.prototype).map(key=>(AdminController.prototype as any)[key]).filter(value=>typeof value==='function');
 expect(handlers.some(fn=>Reflect.getMetadata(PATH_METADATA,fn)==='schedules'&&Reflect.getMetadata(METHOD_METADATA,fn)===RequestMethod.POST)).toBe(false);
 expect(handlers.some(fn=>Reflect.getMetadata(PATH_METADATA,fn)==='schedules'&&Reflect.getMetadata(METHOD_METADATA,fn)===RequestMethod.GET)).toBe(true);
});
