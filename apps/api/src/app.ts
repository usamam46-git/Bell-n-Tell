import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import type { Db } from './db/client.js';
import type { Env } from './env.js';
import { HttpError, sendError } from './http.js';
import { registerAuthRoutes } from './auth/routes.js';
import { registerBusinessRoutes } from './businesses/routes.js';
import { registerOperationsRoutes } from './catalog/routes.js';
import { registerPublicRoutes } from './actions/public-routes.js';
import { expireProposals } from './actions/service.js';
import { registerConversationRoutes } from './conversation/routes.js';
import {OpenAIRealtimeProvider} from './voice/openai.js';
import {VoiceLifecycle} from './voice/lifecycle.js';

export async function buildApp(db: Db, env: Env) {
  const app = Fastify({ logger: env.NODE_ENV === 'test' ? false : { redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers.x-csrf-token', 'req.headers.x-management-handle', 'res.headers.set-cookie'] }, trustProxy: false });
  await app.register(cookie);
  const voice=new VoiceLifecycle(db,env,new OpenAIRealtimeProvider(env));
  let expiryTimer:ReturnType<typeof setInterval>|undefined;
  app.addHook('onReady',async()=>{await voice.reconcile();expiryTimer=setInterval(()=>{void expireProposals(db).catch(()=>app.log.warn('Proposal expiry sweep unavailable'));},30000);expiryTimer.unref();});
  app.addHook('onClose',async()=>{if(expiryTimer)clearInterval(expiryTimer);await voice.shutdown();});
  app.addHook('onSend', async (_request, reply) => { reply.header('cache-control', 'no-store'); reply.header('referrer-policy','no-referrer'); });
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
  registerOperationsRoutes(app, db, env);
  registerPublicRoutes(app, db, env);
  registerConversationRoutes(app, db, env,voice);
  return app;
}
