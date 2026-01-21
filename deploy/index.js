"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.server = exports.blockDeploy = void 0;
const child_process_1 = require("child_process");
const os_1 = __importDefault(require("os"));
const stream_1 = require("stream");
const webhooks_1 = require("@octokit/webhooks");
const concat_stream_1 = __importDefault(require("concat-stream"));
const lodash_1 = require("lodash");
const pm2_1 = __importDefault(require("pm2"));
const logger_1 = __importDefault(require("../lib/logger"));
// @ts-expect-error
const block_js_1 = __importDefault(require("./block.js"));
const log = logger_1.default.child({ bot: 'deploy' });
const webhooks = process.env.GITHUB_WEBHOOK_SECRET ? new webhooks_1.Webhooks({
    secret: process.env.GITHUB_WEBHOOK_SECRET,
}) : null;
if (process.env.NODE_ENV === 'production' && !webhooks) {
    log.warn('[INSECURE] GitHub webhook endpoint is not protected');
}
const commands = [
    ['git', 'checkout', '--', 'package.json', 'package-lock.json', 'functions/package.json', 'functions/package-lock.json'],
    ['git', 'pull'],
    ['git', 'submodule', 'update', '--init', '--recursive'],
    ['npm', 'install', '--production'],
    ['/home/slackbot/.cargo/bin/cargo', 'build', '--release', '--all'],
];
const deployBlocker = new block_js_1.default();
const blockDeploy = (name) => deployBlocker.block(name);
exports.blockDeploy = blockDeploy;
// eslint-disable-next-line require-await
const server = ({ webClient: slack }) => async (fastify) => {
    let triggered = false;
    let thread = null;
    const postMessage = (text) => (slack.chat.postMessage({
        username: `tsgbot-deploy [${os_1.default.hostname()}]`,
        channel: process.env.CHANNEL_SANDBOX,
        text,
        ...(thread === null ? {} : { thread_ts: thread }),
    }));
    // eslint-disable-next-line require-await
    fastify.post('/hooks/github', async (req, res) => {
        if (webhooks) {
            if (await webhooks.verify(req.body, req.headers['x-hub-signature-256']) !== true) {
                res.code(400);
                return 'invalid signature';
            }
        }
        log.info(JSON.stringify({ body: req.body, headers: req.headers }));
        const name = req.headers['x-github-event'];
        if (name === 'ping') {
            return 'pong';
        }
        if (name === 'push') {
            if ((0, lodash_1.get)(req.body, ['repository', 'id']) !== 105612722) {
                res.code(400);
                return 'repository id not match';
            }
            if ((0, lodash_1.get)(req.body, ['ref']) !== 'refs/heads/master') {
                res.code(202);
                return 'refs not match';
            }
            if (triggered) {
                return 'already triggered';
            }
            triggered = true;
            deployBlocker.wait(async () => {
                const message = await postMessage('デプロイを開始します');
                thread = message.ts;
                for (const [command, ...args] of commands) {
                    const proc = (0, child_process_1.spawn)(command, args, { cwd: process.cwd() });
                    const muxed = new stream_1.PassThrough();
                    proc.stdout.on('data', (chunk) => muxed.write(chunk));
                    proc.stderr.on('data', (chunk) => muxed.write(chunk));
                    Promise.all([
                        new Promise((resolve) => proc.stdout.on('end', () => resolve())),
                        new Promise((resolve) => proc.stderr.on('end', () => resolve())),
                    ]).then(() => {
                        muxed.end();
                    });
                    const output = await new Promise((resolve) => {
                        muxed.pipe((0, concat_stream_1.default)({ encoding: 'buffer' }, (data) => {
                            resolve(data);
                        }));
                    });
                    const text = `\`\`\`\n$ ${[command, ...args].join(' ')}\n${output.toString().slice(0, 3500)}\`\`\``;
                    await postMessage(text);
                }
                await new Promise((resolve, reject) => {
                    pm2_1.default.connect((error) => {
                        if (error) {
                            reject(error);
                        }
                        else {
                            resolve();
                        }
                    });
                });
                thread = null;
                await postMessage('死にます:wave:');
                await new Promise((resolve, reject) => {
                    pm2_1.default.restart('app', (error) => {
                        if (error) {
                            reject(error);
                        }
                        else {
                            resolve();
                        }
                    });
                });
            }, 30 * 60 * 1000, // 30min
            (blocks) => {
                log.info(blocks);
                postMessage('デプロイがブロック中だよ:confounded:');
            });
            return 'ok';
        }
        res.code(501);
        return 'not implemented';
    });
};
exports.server = server;
