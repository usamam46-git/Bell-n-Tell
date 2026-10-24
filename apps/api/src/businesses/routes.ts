import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { createBusinessInput, updateBusinessInput, updateSettingsInput, uuid } from '@bellntell/contracts';
import type { Db } from '../db/client.js';
import { businesses, businessMemberships, businessSettings } from '../db/schema.js';
import type { Env } from '../env.js';
import { HttpError, parseBody } from '../http.js';
import { authContext, requireCsrf } from '../auth/routes.js';
import { keyedHash } from '../auth/crypto.js';
import { audit, lockPolicy, bumpPolicy, one } from '../scheduling/service.js';

const params = z.object({ b: uuid });
type Role = 'viewer' | 'manager' | 'owner';
const ranks: Record<Role, number> = { viewer: 1, manager: 2, owner: 3 };
function publicBusiness({ creationKeyHash: _key, creationPayloadHash: _payload, ...business }: typeof businesses.$inferSelect) { void _key; void _payload; return business; }
export async function authorize(request: FastifyRequest, db: Db, env: Env, minimum: Role) {
  const auth = await authContext(request, db, env);
  const { b } = parseBody(params, request.params);
  const [row] = await db.select({ role: businessMemberships.role }).from(businessMemberships).where(and(eq(businessMemberships.businessId, b), eq(businessMemberships.userId, auth.user.id), eq(businessMemberships.status, 'active'))).limit(1);
  if (!row || ranks[row.role as Role] < ranks[minimum]) throw new HttpError(404, 'NOT_FOUND', 'Business not found');
  return { auth, businessId: b, role: row.role as Role };
}
export function requireKey(request: FastifyRequest) {
  const key = request.headers['idempotency-key'];
  if (typeof key !== 'string' || key.length < 8 || key.length > 100) throw new HttpError(400, 'VALIDATION_ERROR', 'Idempotency-Key is required');
  return key;
}
export function registerBusinessRoutes(app: FastifyInstance, db: Db, env: Env) {
  app.get('/api/v1/businesses', async (request) => {
    const auth = await authContext(request, db, env);
    const rows = await db.select({ business: businesses, role: businessMemberships.role }).from(businessMemberships)
      .innerJoin(businesses, eq(businessMemberships.businessId, businesses.id))
      .where(and(eq(businessMemberships.userId, auth.user.id), eq(businessMemberships.status, 'active'))).limit(100);
    return { businesses: rows.map(({ business, role }) => ({ ...publicBusiness(business), role })) };
  });
  app.post('/api/v1/businesses', async (request, reply) => {
    const auth = await authContext(request, db, env); requireCsrf(request, env, auth); const key = requireKey(request);
    const input = parseBody(createBusinessInput, request.body);
    const creationKeyHash = keyedHash(env.AUTH_HASH_KEY, 'business-create-key', `${auth.user.id}:${key}`);
    const creationPayloadHash = keyedHash(env.AUTH_HASH_KEY, 'business-create-payload', JSON.stringify(input));
    const business = await db.transaction(async (tx) => {
      await tx.execute(sql`select id from users where id = ${auth.user.id} for update`);
      const [owned] = await tx.select({ business: businesses }).from(businessMemberships).innerJoin(businesses, eq(businessMemberships.businessId, businesses.id))
        .where(and(eq(businessMemberships.userId, auth.user.id), eq(businessMemberships.role, 'owner'))).limit(1);
      if (owned) {
        if (owned.business.creationKeyHash === creationKeyHash && owned.business.creationPayloadHash === creationPayloadHash) return { business: owned.business, replay: true };
        if (owned.business.creationKeyHash === creationKeyHash) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'Request key was used for different details');
        throw new HttpError(409, 'BUSINESS_LIMIT', 'This owner already created a business');
      }
      const [created] = await tx.insert(businesses).values({ ...input, creationKeyHash, creationPayloadHash }).returning();
      await tx.insert(businessMemberships).values({ businessId: created.id, userId: auth.user.id, role: 'owner' });
      await tx.insert(businessSettings).values({ businessId: created.id });
      await tx.execute(sql`insert into scheduling_policies (business_id) values (${created.id})`);
      return { business: created, replay: false };
    });
    return reply.code(business.replay ? 200 : 201).send({ business: publicBusiness(business.business) });
  });
  app.get('/api/v1/businesses/:b', async (request) => {
    const { businessId } = await authorize(request, db, env, 'viewer');
    const [business] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
    if (!business) throw new HttpError(404, 'NOT_FOUND', 'Business not found');
    return { business: publicBusiness(business) };
  });
  app.patch('/api/v1/businesses/:b', async (request) => {
    const { auth, businessId } = await authorize(request, db, env, 'manager'); requireCsrf(request, env, auth); requireKey(request);
    const input = parseBody(updateBusinessInput, request.body);
    const business = await db.transaction(async tx => {
      await lockPolicy(tx, businessId);
      const [current] = await tx.select().from(businesses).where(eq(businesses.id, businessId));
      if (input.timezone && input.timezone !== current.timezone) {
        if (await one(tx, sql`select id from appointments where business_id=${businessId} and status='confirmed' and starts_at>now() limit 1`)) throw new HttpError(409, 'POLICY_DENIED', 'Timezone cannot change while future confirmed appointments exist');
        await bumpPolicy(tx, businessId);
      }
      const [changed] = await tx.update(businesses).set({ ...(input.name ? { name: input.name } : {}), ...(input.timezone ? { timezone: input.timezone } : {}), revision: sql`${businesses.revision} + 1` }).where(and(eq(businesses.id, businessId), eq(businesses.revision, input.revision))).returning();
      if (!changed) throw new HttpError(409, 'REVISION_CONFLICT', 'Business changed; reload and try again');
      await audit(tx,businessId,'owner',auth.user.id,'business.update','business',businessId);
      return changed;
    });
    if (!business) throw new HttpError(409, 'REVISION_CONFLICT', 'Business changed; reload and try again');
    return { business: publicBusiness(business) };
  });
  app.get('/api/v1/businesses/:b/settings', async (request) => {
    const { businessId } = await authorize(request, db, env, 'viewer');
    const [settings] = await db.select().from(businessSettings).where(eq(businessSettings.businessId, businessId)).limit(1);
    if (!settings) throw new HttpError(404, 'NOT_FOUND', 'Settings not found');
    return { settings };
  });
  app.patch('/api/v1/businesses/:b/settings', async (request) => {
    const { auth, businessId } = await authorize(request, db, env, 'manager'); requireCsrf(request, env, auth); requireKey(request);
    const input = parseBody(updateSettingsInput, request.body);
    const [settings] = await db.update(businessSettings).set({ ...input, revision: sql`${businessSettings.revision} + 1` })
      .where(and(eq(businessSettings.businessId, businessId), eq(businessSettings.revision, input.revision))).returning();
    if (!settings) throw new HttpError(409, 'REVISION_CONFLICT', 'Settings changed; reload and try again');
    return { settings };
  });
}
