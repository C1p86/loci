import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { httpStatusFor, TaskValidationError, XciServerError } from '../errors.js';

const errorHandlerPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.setErrorHandler(
    (err: Error & { validation?: unknown; statusCode?: number }, req, reply) => {
      const requestId = req.id;

      // D-11: TaskValidationError special-case — include structured errors[] array for UI editor.
      // Must precede the generic XciServerError branch.
      if (err instanceof TaskValidationError) {
        fastify.log.info({ requestId, code: err.code }, 'handled TaskValidationError');
        return reply.status(400).send({
          code: err.code,
          message: err.message,
          requestId,
          errors: err.validationErrors,
        });
      }

      if (err instanceof XciServerError) {
        const status = httpStatusFor(err);
        fastify.log.info({ requestId, code: err.code, status }, 'handled XciServerError');
        const body: { code: string; message: string; requestId: string; suggestion?: string } = {
          code: err.code,
          message: err.message,
          requestId,
        };
        if (err.suggestion !== undefined) body.suggestion = err.suggestion;
        return reply.status(status).send(body);
      }

      // fastify body validation errors (JSON schema)
      if (typeof err.validation !== 'undefined') {
        fastify.log.info({ requestId, validation: err.validation }, 'request validation failed');
        return reply.status(400).send({
          code: 'VAL_SCHEMA',
          message: err.message,
          requestId,
        });
      }

      // Rate-limit errors from @fastify/rate-limit
      if (err.statusCode === 429) {
        return reply.status(429).send({
          code: 'RATE_EXCEEDED',
          message: 'Too many requests',
          requestId,
        });
      }

      // Unknown
      fastify.log.error({ err, requestId }, 'unhandled error');
      const body: { code: string; message: string; requestId: string; stack?: string } = {
        code: 'INT_UNKNOWN',
        message: 'Internal server error',
        requestId,
      };
      if (process.env.NODE_ENV !== 'production') {
        body.stack = err.stack ?? String(err);
      }
      return reply.status(500).send(body);
    },
  );
};

export default fp(errorHandlerPlugin, { name: 'error-handler' });
