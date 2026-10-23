import { z } from 'zod';

export const uuid = z.uuid();
export const email = z.string().trim().pipe(z.email().max(254)).transform((value) => value.toLowerCase());
export const password = z.string().min(12).max(256);
export const registerInput = z.strictObject({ email, password, name: z.string().trim().min(1).max(100) });
export const loginInput = z.strictObject({ email, password: z.string().max(256) });
export const recoverInput = z.strictObject({ email, recoveryCode: z.string().min(20).max(100), newPassword: password });
export const rotateRecoveryInput = z.strictObject({ currentPassword: z.string() });
export const timezone = z.string().min(1).max(100).refine((value) => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
}, 'Enter a valid IANA timezone');
export const slug = z.string().trim().max(120).transform((value) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')).pipe(z.string().min(1, 'Public slug needs at least one letter or number').max(60, 'Public slug is too long'));
export const createBusinessInput = z.strictObject({ name: z.string().trim().min(1).max(120), slug, timezone });
export const updateBusinessInput = z.strictObject({ revision: z.int().positive(), name: z.string().trim().min(1).max(120).optional(), timezone: timezone.optional() }).refine((v) => v.name !== undefined || v.timezone !== undefined);
export const faq = z.strictObject({ id: uuid, question: z.string().trim().min(1).max(200), answer: z.string().trim().min(1).max(1000) });
export const updateSettingsInput = z.strictObject({
  revision: z.int().positive(),
  publicEmail: z.email().max(254).nullable(),
  publicPhone: z.string().trim().max(40).nullable(),
  publicAddress: z.string().trim().max(500).nullable(),
  publicWebsite: z.url().max(500).nullable(),
  publicDescription: z.string().trim().max(2000),
  faqs: z.array(faq).max(50),
  greeting: z.string().trim().max(500),
  consentSourceCopy: z.string().trim().max(2000),
  transcriptRetentionDays: z.int().min(1).max(30)
});
export type RegisterInput = z.infer<typeof registerInput>;
export type CreateBusinessInput = z.infer<typeof createBusinessInput>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsInput>;
