import {spawn} from 'child_process';
import os from 'os';
import {PassThrough} from 'stream';
import {Webhooks} from '@octokit/webhooks';
import concat from 'concat-stream';
import {FastifyInstance} from 'fastify';
import {get} from 'lodash';
import pm2 from 'pm2';
import logger from '../lib/logger';
import type {SlackInterface} from '../lib/slack';

// @ts-expect-error
import Blocker from './block.js';

const log = logger.child({bot: 'deploy'});

const webhooks = process.env.GITHUB_WEBHOOK_SECRET ? new Webhooks({
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
const deployBlocker = new Blocker();
export const blockDeploy = (name: string) => deployBlocker.block(name);

// eslint-disable-next-line require-await
export const server = ({webClient: slack}: SlackInterface) => async (fastify: FastifyInstance) => {
	let triggered = false;
	let thread: string = null;

	const postMessage = (text: string) => (
		slack.chat.postMessage({
			username: `tsgbot-deploy [${os.hostname()}]`,
			channel: process.env.CHANNEL_SANDBOX,
			text,
			...(thread === null ? {} : {thread_ts: thread}),
		})
	);

	// eslint-disable-next-line require-await
	fastify.post('/hooks/github', async (req, res) => {
		if (webhooks) {
			if (await webhooks.verify(req.body as any, req.headers['x-hub-signature-256'] as string) !== true) {
				res.code(400);
				return 'invalid signature';
			}
		}

		log.info(JSON.stringify({body: req.body, headers: req.headers}));

		const name = req.headers['x-github-event'];
		if (name === 'ping') {
			return 'pong';
		}

		if (name === 'push') {
			if (get(req.body, ['repository', 'id']) !== 105612722) {
				res.code(400);
				return 'repository id not match';
			}
			if (get(req.body, ['ref']) !== 'refs/heads/master') {
				res.code(202);
				return 'refs not match';
			}

			if (triggered) {
				return 'already triggered';
			}
			triggered = true;

			deployBlocker.wait(
				async () => {
					const message = await postMessage('デプロイを開始します');
					thread = message.ts as string;

					for (const [command, ...args] of commands) {
						const proc = spawn(command, args, {cwd: process.cwd()});
						const muxed = new PassThrough();

						proc.stdout.on('data', (chunk) => muxed.write(chunk));
						proc.stderr.on('data', (chunk) => muxed.write(chunk));

						Promise.all([
							new Promise<void>((resolve) => proc.stdout.on('end', () => resolve())),
							new Promise<void>((resolve) => proc.stderr.on('end', () => resolve())),
						]).then(() => {
							muxed.end();
						});

						const output = await new Promise<Buffer>((resolve) => {
							muxed.pipe(concat({encoding: 'buffer'}, (data: Buffer) => {
								resolve(data);
							}));
						});

						const text = `\`\`\`\n$ ${[command, ...args].join(' ')}\n${output.toString().slice(0, 3500)}\`\`\``;
						await postMessage(text);
					}

					await new Promise<void>((resolve, reject) => {
						pm2.connect((error) => {
							if (error) {
								reject(error);
							} else {
								resolve();
							}
						});
					});

					thread = null;
					await postMessage('死にます:wave:');

					await new Promise<void>((resolve, reject) => {
						pm2.restart('app', (error) => {
							if (error) {
								reject(error);
							} else {
								resolve();
							}
						});
					});
				},
				30 * 60 * 1000, // 30min
				(blocks: any) => {
					log.info(blocks);
					postMessage('デプロイがブロック中だよ:confounded:');
				},
			);

			return 'ok';
		}

		res.code(501);
		return 'not implemented';
	});
};
