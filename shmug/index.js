"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.server = void 0;
const fastify_plugin_1 = __importDefault(require("fastify-plugin"));
const slackUtils_1 = require("../lib/slackUtils");
const server = ({ eventClient, webClient: slack }) => (0, fastify_plugin_1.default)(async (fastify) => {
    const { team: tsgTeam } = await slack.team.info();
    fastify.post('/slash/shmug', async (request, response) => {
        if (request.body.token !== process.env.SLACK_VERIFICATION_TOKEN) {
            response.code(400);
            return 'Bad Request';
        }
        if (request.body.team_id !== tsgTeam.id) {
            response.code(200);
            return '/shmug is only for TSG. Sorry!';
        }
        const username = await (0, slackUtils_1.getMemberName)(request.body.user_id);
        const icon_url = await (0, slackUtils_1.getMemberIcon)(request.body.user_id, 512);
        slack.chat.postMessage({
            username,
            icon_url,
            channel: request.body.channel_id,
            text: request.body.text + ' c|_|',
        });
        return '';
    });
});
exports.server = server;
