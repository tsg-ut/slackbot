import {spawn, spawnSync} from 'child_process';
import os from 'os';
import {PassThrough} from 'stream';
import {Webhooks} from '@octokit/webhooks';
import concat from 'concat-stream';
import {FastifyInstance} from 'fastify';
import {get} from 'lodash';
import pm2 from 'pm2';
import logger from '../lib/logger';
import type {SlackInterface} from '../lib/slack';

import Blocker from './block';

const log = logger.child({bot: 'deploy'});

const webhooks = process.env.GITHUB_WEBHOOK_SECRET ? new Webhooks({
	secret: process.env.GITHUB_WEBHOOK_SECRET,
}) : null;
if (process.env.NODE_ENV === 'production' && !webhooks) {
	log.warn('[INSECURE] GitHub webhook endpoint is not protected');
}

const alwaysCommands = [
	['git', 'checkout', '--', 'package.json', 'package-lock.json', 'functions/package.json', 'functions/package-lock.json'],
	['git', 'pull'],
	['git', 'submodule', 'update', '--init', '--recursive'],
];

const getChangedFiles = (): string[] => {
	const result = spawnSync('git', ['diff', 'ORIG_HEAD', 'HEAD', '--name-only'], {
		cwd: process.cwd(),
		encoding: 'utf-8',
	});
	return result.status === 0 ? result.stdout.split('\n').filter(Boolean) : [];
};

const buildConditionalCommands = (changedFiles: string[]): string[][] => {
	const commands: string[][] = [];
	if (changedFiles.includes('package-lock.json')) {
		commands.push(['npm', 'ci']);
	}
	if (changedFiles.some((f) => f.endsWith('.rs'))) {
		commands.push(['/home/slackbot/.cargo/bin/cargo', 'build', '--release', '--all']);
	}
	commands.push(['npm', 'run', 'build']);
	return commands;
};

const collectStream = (stream: PassThrough): Promise<Buffer> => new Promise<Buffer>((resolve) => {
	stream.pipe(concat({encoding: 'buffer'}, (data: Buffer) => {
		resolve(data);
	}));
});

const deployBlocker = new Blocker();
export const blockDeploy = (name: string) => deployBlocker.block(name);

// eslint-disable-next-line require-await
export const server = ({webClient: slack}: SlackInterface) => async (fastify: FastifyInstance) => {
	// GitHub webhook signature verification requires the raw request body string,
	// so we receive JSON as a string and parse it manually in the route handler.
	fastify.addContentTypeParser('application/json', {parseAs: 'string'}, (_req, body: string, done) => {
		done(null, body);
	});

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

	const runCommand = async (command: string, args: string[]): Promise<void> => {
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

		const output = await collectStream(muxed);

		const text = `\`\`\`\n$ ${[command, ...args].join(' ')}\n${output.toString().slice(0, 3500)}\`\`\``;
		await postMessage(text);
	};

	// eslint-disable-next-line require-await
	fastify.post('/hooks/github', async (req, res) => {
		const rawBody = String(req.body);

		if (webhooks) {
			if (await webhooks.verify(rawBody, req.headers['x-hub-signature-256'] as string) !== true) {
				res.code(400);
				return 'invalid signature';
			}
		}

		const body = JSON.parse(rawBody) as Record<string, unknown>;
		log.info(JSON.stringify({body, headers: req.headers}));

		const name = req.headers['x-github-event'];
		if (name === 'ping') {
			return 'pong';
		}

		if (name === 'push') {
			if (get(body, ['repository', 'id']) !== 105612722) {
				res.code(400);
				return 'repository id not match';
			}
			if (get(body, ['ref']) !== 'refs/heads/master') {
				res.code(202);
				return 'refs not match';
			}

			if (triggered) {
				return 'already triggered';
			}
			triggered = true;

			deployBlocker.wait(
				async () => {
					try {
						const message = await postMessage('デプロイを開始します');
						thread = message.ts as string;

						for (const [command, ...args] of alwaysCommands) {
							await runCommand(command, args);
						}

						const changedFiles = getChangedFiles();
						for (const [command, ...args] of buildConditionalCommands(changedFiles)) {
							await runCommand(command, args);
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
					} catch (error) {
						triggered = false;
						throw error;
					}
				},
				30 * 60 * 1000, // 30min
				(blocks) => {
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
