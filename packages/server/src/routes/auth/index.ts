import type { FastifyPluginAsync } from 'fastify';
import { csrfRoute } from './csrf.js';
import { loginRoute } from './login.js';
import { logoutRoute } from './logout.js';
import { registerAuthMeRoute } from './me.js';
import { requestResetRoute } from './request-reset.js';
import { resetRoute } from './reset.js';
import { signupRoute } from './signup.js';
import { verifyEmailRoute } from './verify-email.js';

export const registerAuthRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(signupRoute);
  await fastify.register(verifyEmailRoute);
  await fastify.register(loginRoute);
  await fastify.register(logoutRoute);
  await fastify.register(requestResetRoute);
  await fastify.register(resetRoute);
  await fastify.register(csrfRoute);
  // Phase 13 D-34: GET /api/auth/me for SPA hydration
  await fastify.register(registerAuthMeRoute);
};
