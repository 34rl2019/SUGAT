import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { VerificationDocumentType, VerificationStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { PrivateDocumentStorageService, PrivateUpload } from '../../common/private-document-storage.service';

type Files = Record<'licenseFront'|'licenseBack'|'selfie', PrivateUpload[]>;
const documentMap: Array<[keyof Files, VerificationDocumentType]> = [
  ['licenseFront', VerificationDocumentType.LICENSE_FRONT],
  ['licenseBack', VerificationDocumentType.LICENSE_BACK],
  ['selfie', VerificationDocumentType.SELFIE],
];

@Injectable()
export class VerificationService {
  constructor(private db: PrismaService, private storage: PrivateDocumentStorageService) {}

  private async driverForUser(userId: string) {
    const driver = await this.db.driver.findUnique({ where: { userId } });
    if (!driver) throw new ForbiddenException('A driver profile is required.');
    return driver;
  }

  async submit(userId: string, files: Partial<Files>) {
    const driver = await this.driverForUser(userId);
    return this.submitForDriver(userId, driver.id, files);
  }

  async submitForDriver(actorId: string, driverId: string, files: Partial<Files>) {
    const driver = await this.db.driver.findUnique({ where: { id: driverId } });
    if (!driver) throw new NotFoundException('Driver not found.');
    if (!driver.licenseNumber || !driver.licenseExpiresAt) throw new BadRequestException('License number and expiration date are required before verification submission.');
    for (const [field] of documentMap) if (files[field]?.length !== 1) throw new BadRequestException(`Exactly one ${field} document is required.`);
    const pending = await this.db.driverVerificationSubmission.findFirst({ where: { driverId: driver.id, status: { in: ['PENDING_VERIFICATION', 'PENDING_REVERIFICATION'] } } });
    if (pending) throw new ConflictException('A verification submission is already pending review.');
    const stored: Array<{ type: VerificationDocumentType; storageKey: string; mimeType: string; sizeBytes: number; sha256: string }> = [];
    try {
      for (const [field, type] of documentMap) stored.push({ type, ...await this.storage.store(files[field]![0]) });
      const status = driver.identityVerificationStatus === VerificationStatus.APPROVED || driver.licenseVerificationStatus === VerificationStatus.APPROVED
        ? VerificationStatus.PENDING_REVERIFICATION : VerificationStatus.PENDING_VERIFICATION;
      return await this.db.$transaction(async tx => {
        const submission = await tx.driverVerificationSubmission.create({ data: { driverId: driver.id, status, documents: { create: stored } }, include: { documents: { select: { id: true, type: true, mimeType: true, sizeBytes: true, createdAt: true } } } });
        await tx.driver.update({ where: { id: driver.id }, data: { identityVerificationStatus: status, licenseVerificationStatus: status } });
        await tx.auditLog.create({ data: { actorId, action: 'driver.verification.submitted', entityType: 'DriverVerificationSubmission', entityId: submission.id, metadata: { driverId, documentTypes: stored.map(item => item.type) } } });
        return submission;
      });
    } catch (error) { await Promise.all(stored.map(item => this.storage.remove(item.storageKey))); throw error; }
  }

  submissions() {
    return this.db.driverVerificationSubmission.findMany({ include: { driver: { select: { id: true, firstName: true, lastName: true, licenseNumber: true, licenseExpiresAt: true } }, documents: { select: { id: true, type: true, mimeType: true, sizeBytes: true, createdAt: true } } }, orderBy: { submittedAt: 'desc' } });
  }

  async review(actorId: string, id: string, decision: 'APPROVED'|'REJECTED', reason?: string) {
    if (decision === 'REJECTED' && !reason?.trim()) throw new BadRequestException('A rejection reason is required.');
    const submission = await this.db.driverVerificationSubmission.findUnique({ where: { id } });
    if (!submission) throw new NotFoundException('Verification submission not found.');
    if (!['PENDING_VERIFICATION', 'PENDING_REVERIFICATION'].includes(submission.status)) throw new ConflictException('Only a pending verification submission can be reviewed.');
    return this.db.$transaction(async tx => {
      const changed = await tx.driverVerificationSubmission.updateMany({ where: { id, status: { in: ['PENDING_VERIFICATION', 'PENDING_REVERIFICATION'] } }, data: { status: decision, rejectionReason: decision === 'REJECTED' ? reason!.trim() : null, reviewedAt: new Date(), reviewedById: actorId } });
      if (changed.count !== 1) throw new ConflictException('Verification submission was already reviewed.');
      await tx.driver.update({ where: { id: submission.driverId }, data: { identityVerificationStatus: decision, licenseVerificationStatus: decision } });
      await tx.auditLog.create({ data: { actorId, action: `driver.verification.${decision.toLowerCase()}`, entityType: 'DriverVerificationSubmission', entityId: id, metadata: decision === 'REJECTED' ? { reason: reason!.trim() } : undefined } });
      return tx.driverVerificationSubmission.findUniqueOrThrow({ where: { id }, include: { documents: { select: { id: true, type: true, mimeType: true, sizeBytes: true, createdAt: true } } } });
    });
  }

  async document(documentId: string) {
    const document = await this.db.driverVerificationDocument.findUnique({ where: { id: documentId }, select: { storageKey: true, mimeType: true } });
    if (!document) throw new NotFoundException('Verification document not found.');
    return { data: await this.storage.read(document.storageKey), mimeType: document.mimeType };
  }
}
