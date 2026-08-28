import { ConflictException } from '@nestjs/common';

export const DUPLICATE_EMAIL_MESSAGE = 'A user with this email address already exists.';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isPrismaUniqueConstraintError(error: unknown, field?: string): boolean {
  if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002')) return false;
  if (!field || !('meta' in error) || !error.meta || typeof error.meta !== 'object' || !('target' in error.meta)) return true;
  const target = error.meta.target;
  return (Array.isArray(target) ? target : [target]).some(value => String(value).includes(field));
}

export function duplicateEmailConflict(): ConflictException {
  return new ConflictException(DUPLICATE_EMAIL_MESSAGE);
}
