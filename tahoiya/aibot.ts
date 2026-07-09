import path from 'path';
import concatStream from 'concat-stream';
// @ts-expect-error: untyped
import Docker from 'dockerode';
import download from 'download';
import japaneseModule from 'japanese';
const {hiraganize} = japaneseModule;
import QueueModule from 'p-queue';
// p-queue の compiled JS は exports.default = X 形式でネストしたdefaultを持つため明示的にunwrapする
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Queue: any = (QueueModule as any).default ?? QueueModule;
import logger from '../lib/logger.js';

import {fileURLToPath} from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const docker = new Docker();
const queue = new Queue({concurrency: 1});
const log = logger.child({bot: 'tahoiya/aibot'});

const downloadBracketsPromise = download('https://www.unicode.org/Public/UCD/latest/ucd/BidiBrackets.txt');

const normalizeBrackets = async (text: string): Promise<string> => {
	const bracketData = await downloadBracketsPromise;
	const bracketEntries = (bracketData as Buffer).toString().split('\n').filter(
		(line: string) => line.length > 0 && !line.startsWith('#'),
	);
	const bracketMap = new Map(bracketEntries.map((line: string) => {
		const [from, to, type] = line.split(/[;#]/);
		return [String.fromCodePoint(parseInt(from.trim(), 16)), {
			pair: String.fromCodePoint(parseInt(to.trim(), 16)),
			type: type.trim() === 'c' ? 'close' : 'open',
		}];
	}));

	const chars = Array.from(text);
	const stack: {index: number; pair: string}[] = [];
	const newChars = chars.map((char, index) => {
		if (!bracketMap.has(char)) {
			return char;
		}

		const {pair, type} = bracketMap.get(char)!;
		if (type === 'open') {
			stack.push({index, pair});
			return char;
		}

		if (type === 'close') {
			if (stack.length === 0) {
				return '';
			}
			const pop = stack.pop()!;
			return pop.pair;
		}

		return '';
	});

	for (const {index} of stack) {
		newChars[index] = '';
	}

	return newChars.join('');
};

export type AIBotModel = 'tahoiyabot-01' | 'tahoiyabot-02';

export interface AIBotResult {
	result: string;
	modelName: AIBotModel;
}

class TimeoutError extends Error {}

const executeModel = async (rawInput: string, modelName: AIBotModel): Promise<AIBotResult | null> => {
	const input = hiraganize(rawInput).replace(/[^\p{Script=Hiragana}ー]/gu, '');
	if (!input) {
		return null;
	}

	let stdoutWriter: ReturnType<typeof concatStream> | null = null;
	let stderrWriter: ReturnType<typeof concatStream> | null = null;

	const stdoutPromise = new Promise<Buffer>((resolve) => {
		stdoutWriter = concatStream({encoding: 'buffer'}, (stdout: Buffer) => resolve(stdout));
	});
	const stderrPromise = new Promise<Buffer>((resolve) => {
		stderrWriter = concatStream({encoding: 'buffer'}, (stderr: Buffer) => resolve(stderr));
	});

	const modelPath = path.join(__dirname, 'models', modelName);
	const dockerVolumePath = path.sep === '\\' ? modelPath.replace('C:\\', '/c/').replace(/\\/g, '/') : modelPath;

	type ContainerLike = {
		stop: () => Promise<void>;
		remove: () => Promise<void>;
		attach: (options: any) => Promise<any>;
		start: () => Promise<void>;
		wait: () => Promise<void>
	};
	let container: ContainerLike | null = null;

	const executeContainer = async () => {
		container = await docker.createContainer({
			Hostname: '',
			User: '',
			AttachStdin: false,
			AttachStdout: true,
			AttachStderr: true,
			Tty: false,
			OpenStdin: false,
			StdinOnce: false,
			Env: null,
			Cmd: ['bash', '/root/run.sh', Array.from(input).join(' '), 'model.ckpt'],
			Image: 'hakatashi/tahoiyabot',
			Volumes: {'/root/model': {}},
			VolumesFrom: [],
			HostConfig: {
				Binds: [`${dockerVolumePath}:/root/model:ro`],
				Memory: 512 * 1024 * 1024,
			},
		});

		if (container === null) {
			throw new Error('Failed to create Docker container');
		}

		const stream = await container.attach({stream: true, stdout: true, stderr: true});
		docker.modem.demuxStream(stream, stdoutWriter, stderrWriter);
		stream.on('end', () => {
			stdoutWriter!.end();
			stderrWriter!.end();
		});

		await container.start();
		await container.wait();
		return container;
	};

	const runner = Promise.all([stdoutPromise, stderrPromise, executeContainer()]);

	let stdout: Buffer | null = null;

	try {
		const result = await Promise.race([
			runner,
			new Promise<never>((_, reject) => {
				setTimeout(() => reject(new TimeoutError()), 60000);
			}),
		]);
		log.debug(`AI bot (${modelName}) stdout: ${result[0].toString()}`);
		log.debug(`AI bot (${modelName}) stderr: ${result[1].toString()}`);
		[stdout] = result;
	} finally {
		if (container !== null) {
			await container.stop().catch((error: {statusCode?: number}) => {
				if (error.statusCode !== 304) {
					throw error;
				}
			});
			await container.remove().catch((error: {statusCode?: number}) => {
				if (error.statusCode !== 304) {
					throw error;
				}
			});
		}
	}

	const resultTokens = (stdout ? stdout.toString() : '').trim().split(' ');
	const result = resultTokens.reduce((previous: string, current: string) => {
		if (previous.endsWith('@@')) {
			return previous.slice(0, -2) + current;
		}
		if (previous.match(/[a-z0-9,]$/i) && current.match(/^[a-z0-9]/)) {
			return `${previous} ${current}`;
		}
		return previous + current;
	}, '');

	return {
		result: await normalizeBrackets(result),
		modelName,
	};
};

export const getAIBotMeaning = (rawInput: string, modelName: AIBotModel): Promise<AIBotResult | null> => (
	queue.add(() => executeModel(rawInput, modelName))
);
