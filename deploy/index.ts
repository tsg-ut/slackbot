// @ts-ignore
import logger from '../lib/logger.js';
import {FastifyInstance} from 'fastify';

export const server = () => async (fastify: FastifyInstance) => {
	fastify.post('/hooks/github', async (req) => {
	});
};