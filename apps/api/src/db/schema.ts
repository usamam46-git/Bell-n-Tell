import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, timestamp, integer, primaryKey, index, jsonb, text, check } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(), email: varchar('email', { length: 254 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(), name: varchar('name', { length: 100 }).notNull(),
  recoveryCodeHash: text('recovery_code_hash').notNull(), disabledAt: ts('disabled_at'),
  createdAt: ts('created_at').defaultNow().notNull()
});
export const authSessions = pgTable('auth_sessions', {
  id: uuid('id').defaultRandom().primaryKey(), userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(), expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'), createdAt: ts('created_at').defaultNow().notNull()
}, (t) => [index('auth_sessions_user_expiry_idx').on(t.userId, t.expiresAt)]);
export const securityThrottles = pgTable('security_throttles', {
  scope: varchar('scope', { length: 40 }).notNull(), hashedSubjectKey: varchar('hashed_subject_key', { length: 64 }).notNull(),
  windowStart: ts('window_start').notNull(), count: integer('count').notNull().default(0), blockedUntil: ts('blocked_until')
}, (t) => [primaryKey({ columns: [t.scope, t.hashedSubjectKey, t.windowStart] }), index('security_throttles_expiry_idx').on(t.blockedUntil), check('security_throttles_count_positive', sql`${t.count} >= 0`)]);
export const businesses = pgTable('businesses', {
  id: uuid('id').defaultRandom().primaryKey(), slug: varchar('slug', { length: 60 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull(), timezone: varchar('timezone', { length: 100 }).notNull(),
  creationKeyHash: varchar('creation_key_hash', { length: 64 }).unique(), creationPayloadHash: varchar('creation_payload_hash', { length: 64 }),
  status: varchar('status', { length: 10 }).notNull().default('setup'), revision: integer('revision').notNull().default(1),
  createdAt: ts('created_at').defaultNow().notNull()
}, (t) => [check('businesses_status_check', sql`${t.status} in ('setup','active','paused')`), check('businesses_revision_positive', sql`${t.revision} > 0`)]);
export const businessMemberships = pgTable('business_memberships', {
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 10 }).notNull(), status: varchar('status', { length: 10 }).notNull().default('active'),
  createdAt: ts('created_at').defaultNow().notNull()
}, (t) => [primaryKey({ columns: [t.businessId, t.userId] }), check('business_memberships_role_check', sql`${t.role} in ('owner','manager','viewer')`), check('business_memberships_status_check', sql`${t.status} in ('active','disabled')`)]);
export const businessSettings = pgTable('business_settings', {
  businessId: uuid('business_id').primaryKey().references(() => businesses.id, { onDelete: 'cascade' }),
  revision: integer('revision').notNull().default(1), publicEmail: varchar('public_email', { length: 254 }),
  publicPhone: varchar('public_phone', { length: 40 }), publicAddress: varchar('public_address', { length: 500 }),
  publicWebsite: varchar('public_website', { length: 500 }), publicDescription: varchar('public_description', { length: 2000 }).notNull().default(''),
  faqs: jsonb('faqs').$type<{ id: string; question: string; answer: string }[]>().notNull().default([]),
  greeting: varchar('greeting', { length: 500 }).notNull().default(''),
  consentSourceCopy: varchar('consent_source_copy', { length: 2000 }).notNull().default(''),
  transcriptRetentionDays: integer('transcript_retention_days').notNull().default(30)
}, (t) => [check('business_settings_revision_positive', sql`${t.revision} > 0`), check('business_settings_retention_range', sql`${t.transcriptRetentionDays} between 1 and 30`)]);
