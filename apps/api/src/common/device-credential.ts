import { createHash, timingSafeEqual } from 'crypto';

export const deviceCredentialHash = (credential: string) => createHash('sha256').update(credential).digest('hex');
export function validDeviceCredential(credential: unknown, hash: string) {
  if (typeof credential !== 'string' || !/^[a-f0-9]{64}$/.test(credential) || !/^[a-f0-9]{64}$/.test(hash)) return false;
  return timingSafeEqual(Buffer.from(deviceCredentialHash(credential), 'hex'), Buffer.from(hash, 'hex'));
}
export const DEVICE_REJECTED = 'This driver account is already registered to another device. Contact the administrator to authorize a new device.';
