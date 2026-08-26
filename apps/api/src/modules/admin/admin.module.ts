import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from '../../common/prisma.service';
import { JwtGuard } from '../../common/auth';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
@Module({imports:[JwtModule.register({})],controllers:[AdminController],providers:[AdminService,PrismaService,JwtGuard]})
export class AdminModule {}
