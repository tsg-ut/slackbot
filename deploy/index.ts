// @ts-ignore
import logger from '../lib/logger.js';
import {get} from 'lodash';
import {FastifyInstance} from 'fastify';
import {WebClient} from '@slack/client';
import {spawn} from 'child_process';
// @ts-ignore
import concat from 'concat-stream';
import {PassThrough} from 'stream';

const commands = [
	['git', 'checkout', '--', 'package.json', 'package-lock.json'],
	['git', 'pull'],
	['npm', 'install', '--production'],
];

export const server = ({webClient: slack}: {webClient: WebClient}) => async (fastify: FastifyInstance) => {
	const postMessage = (text: string) => (
		slack.chat.postMessage({
			channel: process.env.CHANNEL_SANDBOX,
			username: 'deploy',
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

			await postMessage('デプロイを開始します');

			for (const [command, ...args] of commands) {
				const proc = spawn(command, args, {cwd: process.cwd()});
				const muxed = new PassThrough();

				proc.stdout.on('data', (chunk) => muxed.write(chunk));
				proc.stderr.on('data', (chunk) => muxed.write(chunk));

				Promise.all([
					new Promise((resolve) => proc.stdout.on('end', () => resolve())),
					new Promise((resolve) => proc.stderr.on('end', () => resolve())),
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

			setTimeout(() => {
				process.exit(0);
			}, 2000);

			return 'ok';
		}

		res.code(501);
		return 'not implemented';
	});
};
