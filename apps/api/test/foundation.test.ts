import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb } from '../src/db/client.js';
import { buildApp } from '../src/app.js';
import { readEnv } from '../src/env.js';
import { users, businessMemberships } from '../src/db/schema.js';
import { createBusinessInput, registerInput } from '@bellntell/contracts';

const env = readEnv();
const { db, pool } = createDb(env.DATABASE_URL);
const app = await buildApp(db, env);
const nonce = crypto.randomUUID();
const firstEmail = `phase1-a-${nonce}@example.test`;
const secondEmail = `phase1-b-${nonce}@example.test`;
const password = 'correct horse battery stable 34';
const origin = { origin: env.WEB_ORIGIN, 'content-type': 'application/json' };
let firstCookie = ''; let firstCsrf = ''; let firstId = ''; let businessId = '';
let secondCookie = ''; let secondCsrf = ''; let secondId = '';
const post = async (url: string, payload: unknown, cookie?: string, csrf?: string, key?: string) => await app.inject({ method: 'POST', url, headers: { ...origin, ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}), ...(key ? { 'idempotency-key': key } : {}) }, payload: JSON.stringify(payload) });
const patch = async (url: string, payload: unknown, cookie?: string, csrf?: string) => await app.inject({ method: 'PATCH', url, headers: { ...origin, ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}), 'idempotency-key': crypto.randomUUID() }, payload: JSON.stringify(payload) });
beforeAll(async () => { await app.ready(); });
afterAll(async () => { for (const id of [firstId, secondId]) if (id) await db.delete(users).where(eq(users.id, id)); await app.close(); await pool.end(); });

describe('Phase 1 owner foundation', () => {
  it('normalizes short and non-Latin business names without a pattern error', () => {
    expect(createBusinessInput.parse({ name: 'A', slug: 'A', timezone: 'UTC' }).slug).toBe('a');
    expect(createBusinessInput.parse({ name: 'کائنات', slug: 'کائنات', timezone: 'Asia/Karachi' }).slug).toBe('کائنات');
    expect(createBusinessInput.parse({ name: 'Café & Co', slug: 'Café & Co', timezone: 'UTC' }).slug).toBe('café-co');
  });
  it('accepts pasted email whitespace during account registration', () => {
    expect(registerInput.parse({ name: 'Owner', email: '  Person+Work@Example.com  ', password }).email).toBe('person+work@example.com');
  });
  it('registers, stores an opaque session and rejects missing CSRF', async () => {
    const response = await post('/api/v1/auth/register', { email: firstEmail, password, name: 'First Owner' });
    expect(response.statusCode).toBe(201);
    const body = response.json(); firstId = body.user.id; firstCsrf = body.csrfToken; firstCookie = response.cookies[0].name + '=' + response.cookies[0].value;
    expect(body.recoveryCode.length).toBeGreaterThan(30);
    expect(response.cookies[0].httpOnly).toBe(true);
    expect(response.cookies[0].sameSite).toBe('Lax');
    const noCsrf = await post('/api/v1/businesses', { name: 'Alpha', slug: 'alpha', timezone: 'UTC' }, firstCookie, undefined, crypto.randomUUID());
    expect(noCsrf.statusCode).toBe(403);
    const badOrigin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, payload: { email: firstEmail, password } });
    expect(badOrigin.statusCode).toBe(403);
    const creationKey = crypto.randomUUID();
    const create = await post('/api/v1/businesses', { name: 'Alpha', slug: `alpha-${nonce}`, timezone: 'UTC' }, firstCookie, firstCsrf, creationKey);
    expect(create.statusCode).toBe(201); businessId = create.json().business.id;
    const replay = await post('/api/v1/businesses', { name: 'Alpha', slug: `alpha-${nonce}`, timezone: 'UTC' }, firstCookie, firstCsrf, creationKey);
    expect(replay.statusCode).toBe(200); expect(replay.json().business.id).toBe(businessId);
    const changedReplay = await post('/api/v1/businesses', { name: 'Changed', slug: `alpha-${nonce}`, timezone: 'UTC' }, firstCookie, firstCsrf, creationKey);
    expect(changedReplay.statusCode).toBe(409);
    const again = await post('/api/v1/businesses', { name: 'Another', slug: `another-${nonce}`, timezone: 'UTC' }, firstCookie, firstCsrf, crypto.randomUUID());
    expect(again.statusCode).toBe(409);
    const invalidTz = await patch(`/api/v1/businesses/${businessId}`, { revision: 1, timezone: 'Moon/Base' }, firstCookie, firstCsrf);
    expect(invalidTz.statusCode).toBe(400);
  });
  it('keeps two businesses isolated on reads and writes', async () => {
    const registered = await post('/api/v1/auth/register', { email: secondEmail, password, name: 'Second Owner' });
    expect(registered.statusCode).toBe(201); secondId = registered.json().user.id; secondCsrf = registered.json().csrfToken; secondCookie = registered.cookies[0].name + '=' + registered.cookies[0].value;
    const created = await post('/api/v1/businesses', { name: 'Beta', slug: `beta-${nonce}`, timezone: 'Asia/Karachi' }, secondCookie, secondCsrf, crypto.randomUUID());
    expect(created.statusCode).toBe(201);
    const read = await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/settings`, headers: { cookie: secondCookie } });
    expect(read.statusCode).toBe(404);
    const write = await patch(`/api/v1/businesses/${businessId}`, { revision: 1, name: 'Stolen' }, secondCookie, secondCsrf);
    expect(write.statusCode).toBe(404);
    const ownList = await app.inject({ method: 'GET', url: '/api/v1/businesses', headers: { cookie: secondCookie } });
    expect(ownList.json().businesses).toHaveLength(1);
    await db.insert(businessMemberships).values({ businessId, userId: secondId, role: 'viewer' });
    const viewerRead = await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/settings`, headers: { cookie: secondCookie } });
    expect(viewerRead.statusCode).toBe(200);
    const viewerWrite = await patch(`/api/v1/businesses/${businessId}`, { revision: 1, name: 'Stolen' }, secondCookie, secondCsrf);
    expect(viewerWrite.statusCode).toBe(404);
  });
  it('updates settings with a revision and revokes a session at logout', async () => {
    const updated = await patch(`/api/v1/businesses/${businessId}/settings`, { revision: 1, publicEmail: 'hello@alpha.test', publicPhone: null, publicAddress: null, publicWebsite: null, publicDescription: '', faqs: [], greeting: '', consentSourceCopy: '', transcriptRetentionDays: 30 }, firstCookie, firstCsrf);
    expect(updated.statusCode).toBe(200);
    expect(updated.json().settings.revision).toBe(2);
    const stale = await patch(`/api/v1/businesses/${businessId}/settings`, { revision: 1, publicEmail: 'bad@alpha.test', publicPhone: null, publicAddress: null, publicWebsite: null, publicDescription: '', faqs: [], greeting: '', consentSourceCopy: '', transcriptRetentionDays: 30 }, firstCookie, firstCsrf);
    expect(stale.statusCode).toBe(409);
    const logout = await post('/api/v1/auth/logout', {}, firstCookie, firstCsrf);
    expect(logout.statusCode).toBe(200);
    const session = await app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie: firstCookie } });
    expect(session.statusCode).toBe(401);
  });
  it('recovers with the saved code, consumes it and revokes prior sessions', async () => {
    const login = await post('/api/v1/auth/login', { email: secondEmail, password });
    expect(login.statusCode).toBe(200);
    const priorCookie = login.cookies[0].name + '=' + login.cookies[0].value;
    const registered = await db.query.users.findFirst({ where: eq(users.id, secondId) });
    expect(registered?.recoveryCodeHash).not.toBeUndefined();
    // A fresh user gives the test a recovery code without reading any stored secret.
    const email = `phase1-recovery-${nonce}@example.test`;
    const signup = await post('/api/v1/auth/register', { email, password, name: 'Recovery Owner' });
    const signupId = signup.json().user.id;
    try {
      const code = signup.json().recoveryCode;
      const cookie = signup.cookies[0].name + '=' + signup.cookies[0].value;
      const recovered = await post('/api/v1/auth/recover', { email, recoveryCode: code, newPassword: 'replacement password with 1234' });
      expect(recovered.statusCode).toBe(200);
      expect(recovered.json().recoveryCode).not.toBe(code);
      const oldSession = await app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie } });
      expect(oldSession.statusCode).toBe(401);
      const replay = await post('/api/v1/auth/recover', { email, recoveryCode: code, newPassword: 'another long password 12345' });
      expect(replay.statusCode).toBe(401);
      const oldLogin = await post('/api/v1/auth/login', { email, password });
      expect(oldLogin.statusCode).toBe(401);
      const newLogin = await post('/api/v1/auth/login', { email, password: 'replacement password with 1234' });
      expect(newLogin.statusCode).toBe(200);
      const rotate = await post('/api/v1/auth/recovery-code', { currentPassword: 'replacement password with 1234' }, newLogin.cookies[0].name + '=' + newLogin.cookies[0].value, newLogin.json().csrfToken);
      expect(rotate.statusCode).toBe(200);
      expect(rotate.json().recoveryCode).not.toBe(recovered.json().recoveryCode);
    } finally { await db.delete(users).where(eq(users.id, signupId)); }
    const stillValid = await app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie: priorCookie } });
    expect(stillValid.statusCode).toBe(200);
  });
  it('persists a login attempt limit in PostgreSQL', async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await post('/api/v1/auth/login', { email: firstEmail, password: 'wrong password' });
      expect(response.statusCode).toBe(401);
    }
    const limited = await post('/api/v1/auth/login', { email: firstEmail, password });
    expect(limited.statusCode).toBe(429);
  });
});
