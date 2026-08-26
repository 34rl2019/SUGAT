import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from '../../common/prisma.service';
import { LiveController } from './live.controller';
import { LiveService } from './live.service';
import { LiveGateway } from './live.gateway';
import { EtaService } from './eta.service';
@Module({imports:[JwtModule.register({})],controllers:[LiveController],providers:[LiveService,LiveGateway,EtaService,PrismaService],exports:[LiveGateway]})
export class LiveModule {}
