import { Role } from '@prisma/client';
import { AdminVerificationController, DriverVerificationController } from './verification.controller';

describe('Verification controller authorization metadata',()=>{
 it('restricts document retrieval and review to administrators',()=>{expect(Reflect.getMetadata('roles',AdminVerificationController)).toEqual([Role.ADMIN])});
 it('restricts driver submission to authenticated drivers',()=>{expect(Reflect.getMetadata('roles',DriverVerificationController)).toEqual([Role.DRIVER])});
});
