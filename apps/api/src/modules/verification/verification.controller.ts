import { Body, Controller, Get, Param, Post, Res, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { IsIn, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import type { Response } from 'express';
import { AuthUser, CurrentUser, JwtGuard, Roles } from '../../common/auth';
import type { PrivateUpload } from '../../common/private-document-storage.service';
import { VerificationService } from './verification.service';

class ReviewDto { @IsIn(['APPROVED', 'REJECTED']) decision!: 'APPROVED'|'REJECTED'; @IsOptional() @IsString() @MinLength(3) reason?: string; }
const fields = [{ name: 'licenseFront', maxCount: 1 }, { name: 'licenseBack', maxCount: 1 }, { name: 'selfie', maxCount: 1 }];
// Busboy raises partsLimit when the configured boundary is reached, so allow
// one terminal slot while still limiting actual files to the three named fields.
const uploadOptions = { limits: { fileSize: 5 * 1024 * 1024, files: 3, fields: 0, parts: 4 } };

@UseGuards(JwtGuard) @Roles(Role.DRIVER) @Controller('driver/verification')
export class DriverVerificationController {
  constructor(private verification: VerificationService) {}
  @Post('submissions') @UseInterceptors(FileFieldsInterceptor(fields, uploadOptions))
  submit(@CurrentUser() user: AuthUser, @UploadedFiles() files: Record<string, PrivateUpload[]>) { return this.verification.submit(user.sub, files); }
}

@UseGuards(JwtGuard) @Roles(Role.ADMIN) @Controller('admin/verification')
export class AdminVerificationController {
  constructor(private verification: VerificationService) {}
  @Get('submissions') submissions() { return this.verification.submissions(); }
  @Post('drivers/:driverId/submissions') @UseInterceptors(FileFieldsInterceptor(fields, uploadOptions))
  submitForDriver(@CurrentUser() user: AuthUser, @Param('driverId') driverId: string, @UploadedFiles() files: Record<string, PrivateUpload[]>) { return this.verification.submitForDriver(user.sub, driverId, files); }
  @Post('submissions/:id/review') review(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReviewDto) { return this.verification.review(user.sub, id, dto.decision, dto.reason); }
  @Get('documents/:id') async document(@Param('id') id: string, @Res() response: Response) {
    const document = await this.verification.document(id);
    response.setHeader('Content-Type', document.mimeType);
    response.setHeader('Content-Disposition', 'inline');
    response.setHeader('Cache-Control', 'private, no-store');
    response.send(document.data);
  }
}
