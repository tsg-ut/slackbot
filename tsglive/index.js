"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.server = void 0;
const fastify_plugin_1 = __importDefault(require("fastify-plugin"));
const firestore_1 = require("../lib/firestore");
const slackUtils_1 = require("../lib/slackUtils");
const server = ({ webClient: slack }) => {
    const callback = async (fastify, opts, next) => {
        const { team } = await slack.team.info();
        fastify.post('/slash/tsglive', async (req, res) => {
            if (req.body.token !== process.env.SLACK_VERIFICATION_TOKEN) {
                res.code(400);
                return 'Bad Request';
            }
            if (req.body.team_id !== team.id) {
                res.code(200);
                return '/tsglive is only for TSG. Sorry!';
            }
            let teamId = null;
            if (req.body.channel_name === 'live-players-kanto') {
                teamId = 0;
            }
            else if (req.body.channel_name === 'live-players-kansai') {
                teamId = 1;
            }
            else {
                return '#live-players-kanto もしくは #live-players-kansai チャンネルから実行してください';
            }
            const name = await (0, slackUtils_1.getMemberName)(req.body.user_id);
            await firestore_1.liveDb.collection('tsglive_comments').add({
                user: req.body.user_id,
                name,
                text: req.body.text,
                date: new Date(),
                team: teamId,
            });
            const emoji = teamId === 0 ? ':large_blue_circle:' : ':red_circle:';
            await slack.chat.postMessage({
                channel: req.body.channel_id,
                username: `${name} (tsg-live-controller)`,
                icon_emoji: emoji,
                text: req.body.text,
            });
            await slack.chat.postMessage({
                channel: 'C01AKTFRZGA', // #live-operation
                username: `${name} (tsg-live-controller)`,
                icon_emoji: emoji,
                text: req.body.text,
            });
            return '';
        });
        next();
    };
    return (0, fastify_plugin_1.default)(callback);
};
exports.server = server;
