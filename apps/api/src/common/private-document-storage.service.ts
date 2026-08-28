import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { mkdir, open, readFile, unlink } from 'fs/promises';
import { resolve } from 'path';

export type PrivateUpload = { buffer: Buffer; mimetype: string; size: number };
type StoredDocument = { storageKey: string; mimeType: string; sizeBytes: number; sha256: string };

const MAX_BYTES = 5 * 1024 * 1024;
const signatures = [
  { mime: 'image/jpeg', extension: 'jpg', matches: (b: Buffer) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', extension: 'png', matches: (b: Buffer) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  { mime: 'application/pdf', extension: 'pdf', matches: (b: Buffer) => b.length >= 5 && b.subarray(0, 5).toString('ascii') === '%PDF-' },
];

@Injectable()
export class PrivateDocumentStorageService {
  private readonly root = resolve(process.env.DRIVER_DOCUMENT_STORAGE_DIR ?? 'var/private/driver-verification');

  async store(file: PrivateUpload): Promise<StoredDocument> {
    if (!file?.buffer?.length || file.size !== file.buffer.length) throw new BadRequestException('Verification document is empty or malformed.');
    if (file.size > MAX_BYTES) throw new BadRequestException('Each verification document must be 5 MB or smaller.');
    const format = signatures.find(candidate => candidate.mime === file.mimetype && candidate.matches(file.buffer));
    if (!format) throw new BadRequestException('Only genuine JPEG, PNG, or PDF verification documents are allowed.');
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const storageKey = `${randomBytes(24).toString('hex')}.${format.extension}`;
    const handle = await open(resolve(this.root, storageKey), 'wx', 0o600);
    try { await handle.writeFile(file.buffer); } finally { await handle.close(); }
    return { storageKey, mimeType: format.mime, sizeBytes: file.size, sha256: createHash('sha256').update(file.buffer).digest('hex') };
  }

  async read(storageKey: string) {
    if (!/^[a-f0-9]{48}\.(jpg|png|pdf)$/.test(storageKey)) throw new NotFoundException('Verification document not found.');
    try { return await readFile(resolve(this.root, storageKey)); } catch { throw new NotFoundException('Verification document not found.'); }
  }

  async remove(storageKey: string) { try { await unlink(resolve(this.root, storageKey)); } catch { /* Already absent. */ } }
}
