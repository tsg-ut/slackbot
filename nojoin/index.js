"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.server = void 0;
const fastify_plugin_1 = __importDefault(require("fastify-plugin"));
const state_1 = __importDefault(require("../lib/state"));
const server = async ({ eventClient, webClient: slack }) => {
    const state = await state_1.default.init('nojoin', {
        optoutUsers: [],
    });
    eventClient.on('message', async (message) => {
        if ((message.subtype === 'channel_join' && message.channel === process.env.CHANNEL_SANDBOX) ||
            message.subtype === 'channel_leave') {
            if (state.optoutUsers.includes(message.user)) {
                return;
            }
            await slack.chat.delete({
                token: process.env.HAKATASHI_TOKEN,
                channel: message.channel,
                ts: message.ts,
            });
        }
    });
    const callback = async (fastify, opts, next) => {
        fastify.post('/slash/nojoin', async (req, res) => {
            if (req.body.token !== process.env.SLACK_VERIFICATION_TOKEN) {
                res.code(400);
                return 'Bad Request';
            }
            const command = req.body.text.trim();
            if (command === 'optin') {
                if (state.optoutUsers.includes(req.body.user_id)) {
                    state.optoutUsers.splice(state.optoutUsers.indexOf(req.body.user_id), 1);
                    return 'オプトインしたよ😘';
                }
                return 'もうすでにオプトインしてるよ🥰';
            }
            if (command === 'optout') {
                if (!state.optoutUsers.includes(req.body.user_id)) {
                    state.optoutUsers.push(req.body.user_id);
                    return 'オプトアウトしたよ😘';
                }
                return 'もうすでにオプトアウトしてるよ🥰';
            }
            return 'Usage: /nojoin [optin|optout]';
        });
    };
    return (0, fastify_plugin_1.default)(callback);
};
exports.server = server;
