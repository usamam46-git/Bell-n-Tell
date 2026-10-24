import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';
export class HttpError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new HttpError(400, 'VALIDATION_ERROR', result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  return result.data;
}
export function sendError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof HttpError) return reply.code(error.status).send({ error: { code: error.code, message: error.message, requestId: request.id } });
  const cause = typeof error === 'object' && error !== null && 'cause' in error ? error.cause : error;
  const code = typeof cause === 'object' && cause !== null && 'code' in cause ? String(cause.code) : '';
  if (['ECONNREFUSED','ETIMEDOUT','ECONNRESET','ENOTFOUND','57P01','57P02','57P03','53300'].includes(code) || (error instanceof Error && /connection terminated|connection timeout/i.test(error.message))) return reply.code(503).send({error:{code:'TEMPORARILY_UNAVAILABLE',message:'The database is unavailable. Please try again shortly.',requestId:request.id}});
  if (code === '23P01') return reply.code(409).send({error:{code:'SLOT_UNAVAILABLE',message:'That time is no longer available',requestId:request.id}});
  if (['23503','23514','22P02'].includes(code)) return reply.code(400).send({error:{code:'VALIDATION_ERROR',message:'Invalid or unavailable record details',requestId:request.id}});
  if (typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 400) return reply.code(400).send({error:{code:'VALIDATION_ERROR',message:'Invalid JSON request',requestId:request.id}});
  if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === '23505') {
    const isSlug = 'constraint' in cause && cause.constraint === 'businesses_slug_unique';
    return reply.code(409).send({ error: { code: isSlug ? 'SLUG_TAKEN' : 'CONFLICT', message: isSlug ? 'This public slug is already in use' : 'This value is already in use', requestId: request.id } });
  }
  request.log.error({ errorType: error instanceof Error ? error.name : 'unknown' }, 'Unhandled request error');
  return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId: request.id } });
}
