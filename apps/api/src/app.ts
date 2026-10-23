import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import type { Db } from './db/client.js';
import type { Env } from './env.js';
import { HttpError, sendError } from './http.js';
import { registerAuthRoutes } from './auth/routes.js';
import { registerBusinessRoutes } from './businesses/routes.js';

export async function buildApp(db: Db, env: Env) {
  const app = Fastify({ logger: { redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers.x-csrf-token', 'res.headers.set-cookie'] }, trustProxy: false });
  await app.register(cookie);
  app.addHook('onRequest', async (request) => {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)) {
      if (request.headers.origin !== env.WEB_ORIGIN) throw new HttpError(403, 'ORIGIN_INVALID', 'Invalid request origin');
      if (!request.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'CONTENT_TYPE_INVALID', 'JSON required');
    }
  });
  app.setErrorHandler(sendError);
  app.get('/api/v1/health', async () => ({ ok: true }));
  registerAuthRoutes(app, db, env);
  registerBusinessRoutes(app, db, env);
  return app;
}
