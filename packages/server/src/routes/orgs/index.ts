import type { FastifyPluginAsync } from 'fastify';
import { invitesRoute, membersRoute } from './invites.js';

export const registerOrgRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(invitesRoute);
  await fastify.register(membersRoute);
};
