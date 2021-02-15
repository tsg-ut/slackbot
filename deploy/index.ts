import {spawn} from 'child_process';
import {PassThrough} from 'stream';
// @ts-ignore
import concat from 'concat-stream';
import {FastifyInstance} from 'fastify';
import {get} from 'lodash';
// @ts-ignore
import logger from '../lib/logger.js';
import os from 'os';
import type {SlackInterface} from '../lib/slack';

// @ts-ignore
import Blocker from './block.js';

const commands = [
	['git', 'checkout', '--', 'package.json', 'package-lock.json'],
	['git', 'pull'],
	['git', 'submodule', 'update', '--init', '--recursive'],
	['npm', 'install', '--production'],
	['/home/slackbot/.cargo/bin/cargo', 'build', '--release', '--all'],
];
const deployBlocker = new Blocker();
export const blockDeploy = (name: string) => deployBlocker.block(name);

export const server = ({webClient: slack}: SlackInterface) => async (fastify: FastifyInstance) => {
	let triggered = false;

	const postMessage = (text: string) => (
		slack.chat.postMessage({
			username: `tsgbot-deploy [${os.hostname()}]`,
			channel: process.env.CHANNEL_SANDBOX,
			text,
		})
	);

	fastify.post('/hooks/github', async (req, res) => {
		logger.info(JSON.stringify({body: req.body, headers: req.headers}));

		const name = req.headers['x-github-event'];
		if (name === 'ping') {
			return 'pong';
		}

		if (name === 'push') {
			// TODO: Validation
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
					await postMessage('デプロイを開始します');

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

					await postMessage('死にます:wave:');

					await new Promise<void>((resolve) => setTimeout(() => {
						process.exit(0);
						resolve();
					}, 2000));
				},
				30 * 60 * 1000, // 30min
				(blocks: any) => {
					logger.info(blocks);
					postMessage('デプロイがブロック中だよ:confounded:');
				},
			);

			return 'ok';
		}

		res.code(501);
		return 'not implemented';
	});
};
