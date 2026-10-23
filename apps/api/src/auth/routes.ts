import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { registerInput, loginInput, recoverInput, rotateRecoveryInput } from '@bellntell/contracts';
import type { Db } from '../db/client.js';
import { users, authSessions } from '../db/schema.js';
import type { Env } from '../env.js';
import { HttpError, parseBody } from '../http.js';
import { hashPassword, keyedHash, randomSecret, safeEqual, verifyPassword } from './crypto.js';
import { consumeThrottle, clearThrottle } from './throttle.js';

const COOKIE = 'bnt_session';
const EXPIRES_MS = 7 * 24 * 60 * 60 * 1000;
type User = typeof users.$inferSelect;
export type AuthContext = { user: User; token: string; sessionId: string };
function cookieOptions(env: Env) { return { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: env.NODE_ENV === 'production', maxAge: EXPIRES_MS / 1000 }; }
function csrf(env: Env, token: string) { return keyedHash(env.AUTH_HASH_KEY, 'csrf', token); }
async function createSession(db: Db, env: Env, userId: string, reply: FastifyReply) {
  const token = randomSecret();
  await db.insert(authSessions).values({ userId, tokenHash: keyedHash(env.AUTH_HASH_KEY, 'session', token), expiresAt: new Date(Date.now() + EXPIRES_MS) });
  reply.setCookie(COOKIE, token, cookieOptions(env));
  return csrf(env, token);
}
export async function authContext(request: FastifyRequest, db: Db, env: Env): Promise<AuthContext> {
  const token = request.cookies[COOKIE];
  if (!token) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in required');
  const [row] = await db.select({ session: authSessions, user: users }).from(authSessions).innerJoin(users, eq(authSessions.userId, users.id))
    .where(and(eq(authSessions.tokenHash, keyedHash(env.AUTH_HASH_KEY, 'session', token)), isNull(authSessions.revokedAt), gt(authSessions.expiresAt, new Date()), isNull(users.disabledAt))).limit(1);
  if (!row) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in required');
  return { user: row.user, token, sessionId: row.session.id };
}
export function requireCsrf(request: FastifyRequest, env: Env, auth: AuthContext) {
  const header = request.headers['x-csrf-token'];
  if (typeof header !== 'string' || !safeEqual(header, csrf(env, auth.token))) throw new HttpError(403, 'CSRF_INVALID', 'Invalid request token');
}
export function registerAuthRoutes(app: FastifyInstance, db: Db, env: Env) {
  app.post('/api/v1/auth/register', async (request, reply) => {
    const input = parseBody(registerInput, request.body);
    const subject = `${request.ip}:${input.email}`;
    if (!await consumeThrottle(db, env.AUTH_HASH_KEY, 'register', subject, 5)) throw new HttpError(429, 'RATE_LIMITED', 'Try again later');
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
    if (existing) throw new HttpError(409, 'ACCOUNT_EXISTS', 'This account already exists');
    const recoveryCode = randomSecret();
    const [user] = await db.insert(users).values({ email: input.email, name: input.name, passwordHash: await hashPassword(input.password), recoveryCodeHash: keyedHash(env.AUTH_HASH_KEY, 'recovery', recoveryCode) }).returning();
    const csrfToken = await createSession(db, env, user.id, reply);
    return reply.code(201).send({ user: { id: user.id, email: user.email, name: user.name }, recoveryCode, csrfToken });
  });
  app.post('/api/v1/auth/login', async (request, reply) => {
    const input = parseBody(loginInput, request.body);
    const subject = `${request.ip}:${input.email}`;
    if (!await consumeThrottle(db, env.AUTH_HASH_KEY, 'login', subject, 5)) throw new HttpError(429, 'RATE_LIMITED', 'Try again later');
    const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
    if (!user || user.disabledAt || !await verifyPassword(user.passwordHash, input.password)) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    await clearThrottle(db, env.AUTH_HASH_KEY, 'login', subject);
    const csrfToken = await createSession(db, env, user.id, reply);
    return { user: { id: user.id, email: user.email, name: user.name }, csrfToken };
  });
  app.get('/api/v1/auth/session', async (request) => {
    const auth = await authContext(request, db, env);
    return { user: { id: auth.user.id, email: auth.user.email, name: auth.user.name }, csrfToken: csrf(env, auth.token) };
  });
  app.post('/api/v1/auth/logout', async (request, reply) => {
    const auth = await authContext(request, db, env); requireCsrf(request, env, auth);
    await db.update(authSessions).set({ revokedAt: new Date() }).where(eq(authSessions.id, auth.sessionId));
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });
  app.post('/api/v1/auth/recover', async (request, reply) => {
    const input = parseBody(recoverInput, request.body);
    const subject = `${request.ip}:${input.email}`;
    if (!await consumeThrottle(db, env.AUTH_HASH_KEY, 'recover', subject, 5)) throw new HttpError(429, 'RATE_LIMITED', 'Try again later');
    const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
    const inputHash = keyedHash(env.AUTH_HASH_KEY, 'recovery', input.recoveryCode);
    if (!user || user.disabledAt || !safeEqual(user.recoveryCodeHash, inputHash)) throw new HttpError(401, 'RECOVERY_FAILED', 'Recovery details were not accepted');
    const nextCode = randomSecret(); const nextHash = keyedHash(env.AUTH_HASH_KEY, 'recovery', nextCode);
    const nextPasswordHash = await hashPassword(input.newPassword);
    await db.transaction(async (tx) => {
      const updated = await tx.update(users).set({ passwordHash: nextPasswordHash, recoveryCodeHash: nextHash }).where(and(eq(users.id, user.id), eq(users.recoveryCodeHash, inputHash))).returning({ id: users.id });
      if (!updated.length) throw new HttpError(401, 'RECOVERY_FAILED', 'Recovery details were not accepted');
      await tx.update(authSessions).set({ revokedAt: new Date() }).where(eq(authSessions.userId, user.id));
    });
    await clearThrottle(db, env.AUTH_HASH_KEY, 'recover', subject);
    reply.clearCookie(COOKIE, { path: '/' });
    return { recoveryCode: nextCode };
  });
  app.post('/api/v1/auth/recovery-code', async (request) => {
    const auth = await authContext(request, db, env); requireCsrf(request, env, auth);
    const input = parseBody(rotateRecoveryInput, request.body);
    if (!await consumeThrottle(db, env.AUTH_HASH_KEY, 'rotate', `${request.ip}:${auth.user.id}`, 5)) throw new HttpError(429, 'RATE_LIMITED', 'Try again later');
    if (!await verifyPassword(auth.user.passwordHash, input.currentPassword)) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid password');
    const recoveryCode = randomSecret();
    await db.update(users).set({ recoveryCodeHash: keyedHash(env.AUTH_HASH_KEY, 'recovery', recoveryCode) }).where(eq(users.id, auth.user.id));
    return { recoveryCode };
  });
}
