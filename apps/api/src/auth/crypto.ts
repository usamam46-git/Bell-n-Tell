import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';

export const randomSecret = () => randomBytes(32).toString('base64url');
export function keyedHash(key: string, purpose: string, value: string) {
  return createHmac('sha256', key).update(`${purpose}\0${value}`).digest('hex');
}
export function safeEqual(a: string, b: string) {
  const aBuffer = Buffer.from(a); const bBuffer = Buffer.from(b);
  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}
export const hashPassword = (password: string) => argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
export const verifyPassword = (hash: string, password: string) => argon2.verify(hash, password);
