"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const firestore_1 = __importDefault(require("../lib/firestore"));
const logger_1 = __importDefault(require("../lib/logger"));
const slackUtils_1 = require("../lib/slackUtils");
const topic_1 = require("../topic");
const log = logger_1.default.child({ bot: 'api' });
exports.default = () => {
    const fastify = (0, fastify_1.default)({
        logger: logger_1.default.child({ bot: 'http/api' }),
        pluginTimeout: 50000,
    });
    fastify.get('/', (request, reply) => {
        if (request.query.return_to) {
            const normalizedUrl = new URL(request.query.return_to.toString(), process.env.API_ENDPOINT).toString();
            reply.redirect(normalizedUrl);
            return;
        }
        reply.type('text/html');
        reply.send('<h1>You successfully authorized an access to the API endpoint of <a href="https://github.com/tsg-ut/slackbot">slackbot</a>!</h1>');
    });
    fastify.get('/slack/users', async (request, reply) => {
        const members = await (0, slackUtils_1.getAllTSGMembers)();
        reply.send(members);
    });
    fastify.get('/topic/topics', async (request, reply) => {
        const user = request.headers['x-user'];
        const topics = await firestore_1.default.collection('topic_messages').get();
        reply.send(topics.docs.map((doc) => {
            const topic = doc.data();
            const isLiked = topic.likes.includes(user);
            return { ...topic, isLiked };
        }));
    });
    fastify.put('/topic/topics/:ts/like', async (request, reply) => {
        const user = request.headers['x-user'];
        const { ts } = request.params;
        if (typeof user !== 'string' || typeof ts !== 'string') {
            reply.statusCode = 400;
            reply.send('Bad Request');
            return;
        }
        await (0, topic_1.addLike)(user, ts);
        reply.send('ok');
    });
    fastify.delete('/topic/topics/:ts/like', async (request, reply) => {
        const user = request.headers['x-user'];
        const { ts } = request.params;
        if (typeof user !== 'string' || typeof ts !== 'string') {
            reply.statusCode = 400;
            reply.send('Bad Request');
            return;
        }
        await (0, topic_1.removeLike)(user, ts);
        reply.send('ok');
    });
    fastify.listen({
        port: process.env.API_PORT ? parseInt(process.env.API_PORT) : 20137,
        host: '0.0.0.0',
    }, (error, address) => {
        if (error) {
            log.error(error);
        }
        else {
            log.info(`API server launched at ${address}`);
        }
    });
};
