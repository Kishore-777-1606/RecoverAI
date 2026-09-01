import { randomUUID } from 'crypto';

/**
 * Generates a cryptographically secure random v4 UUID.
 */
export function generateUUID(): string {
  return randomUUID();
}

/**
 * Validates whether a given string is a valid UUID structure.
 */
export function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}
