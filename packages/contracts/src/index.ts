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



export const revision = z.int().positive();
const name = z.string().trim().min(1).max(100);
export const contactInput = z.strictObject({ name, phone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/, 'Use international phone format, e.g. +923001234567').nullable(), email: email.nullable() }).refine(v => v.phone || v.email, 'Phone or email is required');
export const serviceInput = z.strictObject({ name, durationMinutes: z.int().min(5).max(480).multipleOf(5).default(30), publicDescription: z.string().trim().max(2000).default(''), priceText: z.string().trim().max(200).default(''), active: z.boolean().default(true), resourceIds: z.array(uuid).max(100).refine(v => new Set(v).size === v.length) });
export const serviceUpdate = serviceInput.extend({ revision });
export const resourceInput = z.strictObject({ displayName: name, active: z.boolean().default(true) });
export const resourceUpdate = resourceInput.extend({ revision });
export const policyInput = z.strictObject({ revision, slotMinutes: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30), z.literal(60)]), noticeMinutes: z.int().min(0).max(10080), horizonDays: z.int().min(1).max(180), cutoffMinutes: z.int().min(0).max(10080) });
export const localDate = z.iso.date();
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/);
const interval = z.strictObject({ start: time, end: time }).refine(v => v.start < v.end && v.start !== '24:00', 'Hours must end after they start; split overnight hours across dates');
export const hoursInput = z.strictObject({ revision, weekly: z.array(z.strictObject({ weekday: z.int().min(0).max(6), intervals: z.array(interval).max(12) })).max(7), overrides: z.array(z.strictObject({ date: localDate, resourceId: uuid.nullable(), closed: z.boolean(), intervals: z.array(interval).max(12) }).refine(v => v.closed ? v.intervals.length === 0 : v.intervals.length > 0, 'Closed dates have no intervals; open dates need intervals')).max(366) }).superRefine((v, ctx) => {
  const keys = [...v.weekly.map(x => `w:${x.weekday}`), ...v.overrides.map(x => `${x.resourceId}:${x.date}`)];
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: 'custom', message: 'Duplicate weekday or date/resource scope' });
  for (const row of [...v.weekly, ...v.overrides]) {
    const sorted = [...row.intervals].sort((a,b) => a.start.localeCompare(b.start));
    if (sorted.some((x,i) => i > 0 && x.start < sorted[i-1].end)) ctx.addIssue({ code: 'custom', message: 'Hours must not overlap' });
  }
});
export const inquiryInput = z.strictObject({ contact: contactInput, summary: z.string().trim().min(1).max(2000), type: z.enum(['lead', 'callback']), consentVersion: z.literal('contact-v1'), consent: z.literal(true) });
const instant = z.iso.datetime({ offset: true });
export const proposalInput = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('book'), serviceId: uuid, resourceId: uuid, startsAt: instant, contact: contactInput }),
  z.strictObject({ kind: z.literal('reschedule'), appointmentId: uuid, appointmentRevision: revision, resourceId: uuid, startsAt: instant, overrideReason: z.string().trim().min(5).max(500).optional() }),
  z.strictObject({ kind: z.literal('cancel'), appointmentId: uuid, appointmentRevision: revision, overrideReason: z.string().trim().min(5).max(500).optional() }),
  z.strictObject({ kind: z.literal('inquiry'), ...inquiryInput.shape })
]);
export const confirmInput = z.strictObject({ revision, confirm: z.literal(true) });
export const inquiryUpdate = z.strictObject({ revision, status: z.enum(['new','in_progress','resolved']), ownerNote: z.string().trim().max(2000).nullable() });
export const customerUpdate = z.strictObject({ revision, contact: contactInput });
export const appointmentStatus = z.strictObject({ revision, status: z.enum(['completed','no_show']) });
export const recoveryReason = z.strictObject({ reason: z.string().trim().min(5).max(500) });
export const verificationInput = z.strictObject({ reference: z.string().min(8).max(60), token: z.string().min(20).max(100) });
export const managementProposal = z.strictObject({ handle: z.string().max(3000), action: z.discriminatedUnion('kind', [z.strictObject({kind: z.literal('cancel'), appointmentRevision: revision}), z.strictObject({kind: z.literal('reschedule'), appointmentRevision: revision, startsAt: instant, resourceId: uuid})]) });
export const managementConfirm = confirmInput.extend({ handle: z.string().max(3000) });
export const availabilityInput = z.strictObject({ serviceId: uuid, resourceId: uuid.optional(), from: localDate, to: localDate }).refine(v => v.from <= v.to && (Date.parse(v.to)-Date.parse(v.from)) / 86400000 < 7, 'Choose a range of at most seven days');
export const listInput = z.strictObject({ cursor: z.string().max(100).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
