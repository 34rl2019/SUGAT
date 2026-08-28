import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtGuard } from '../../common/auth';
import { PrismaService } from '../../common/prisma.service';
import { PrivateDocumentStorageService } from '../../common/private-document-storage.service';
import { AdminVerificationController, DriverVerificationController } from './verification.controller';
import { VerificationService } from './verification.service';

@Module({ imports: [JwtModule.register({})], controllers: [DriverVerificationController, AdminVerificationController], providers: [VerificationService, PrivateDocumentStorageService, PrismaService, JwtGuard] })
export class VerificationModule {}
