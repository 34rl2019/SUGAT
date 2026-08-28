import { BadRequestException } from '@nestjs/common';
import { mkdtemp, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrivateDocumentStorageService } from './private-document-storage.service';

describe('PrivateDocumentStorageService',()=>{let root:string;beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'sugat-private-'));process.env.DRIVER_DOCUMENT_STORAGE_DIR=root});afterEach(async()=>{delete process.env.DRIVER_DOCUMENT_STORAGE_DIR;await rm(root,{recursive:true,force:true})});
 it('validates content signatures, uses non-guessable names, and stores private files',async()=>{const service=new PrivateDocumentStorageService();const saved=await service.store({buffer:Buffer.from([0xff,0xd8,0xff,1]),mimetype:'image/jpeg',size:4});expect(saved.storageKey).toMatch(/^[a-f0-9]{48}\.jpg$/);expect((await stat(join(root,saved.storageKey))).mode&0o777).toBe(0o600);await expect(service.read(saved.storageKey)).resolves.toEqual(Buffer.from([0xff,0xd8,0xff,1]))});
 it('rejects a spoofed MIME type',async()=>{const service=new PrivateDocumentStorageService();await expect(service.store({buffer:Buffer.from('not an image'),mimetype:'image/jpeg',size:12})).rejects.toBeInstanceOf(BadRequestException)});
});
