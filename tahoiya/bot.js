const Docker = require('dockerode');
const concatStream = require('concat-stream');
const {hiraganize} = require('japanese');
const path = require('path');
const assert = require('assert');
const download = require('download');

const docker = new Docker();

class TimeoutError extends Error { }

const downloadBracketsPromise = download('https://www.unicode.org/Public/UCD/latest/ucd/BidiBrackets.txt');

const normalizeBrackets = async (text) => {
	const bracketData = await downloadBracketsPromise;
	const bracketEntries = bracketData.toString().split('\n').filter((line) => line.length > 0 && !line.startsWith('#'));
	const bracketMap = new Map(bracketEntries.map((line) => {
		const [from, to, type] = line.split(/[;#]/);
		return [String.fromCodePoint(parseInt(from.trim(), 16)), {
			pair: String.fromCodePoint(parseInt(to.trim(), 16)),
			type: type.trim() === 'c' ? 'close' : 'open',
		}];
	}));
	const chars = Array.from(text);
	const stack = [];
	const newChars = chars.map((char, index) => {
		if (!bracketMap.has(char)) {
			return char;
		}

		const {pair, type} = bracketMap.get(char);
		if (type === 'open') {
			stack.push({index, char, pair});
			return char;
		}

		if (type === 'close') {
			if (stack.length === 0) {
				return '';
			}

			const pop = stack.pop();
			return pop.pair;
		}

		return '';
	});

	for (const {index} of stack) {
		newChars[index] = '';
	}

	return newChars.join('');
};

module.exports.getResult = async (rawInput, modelName) => {
	assert(modelName === 'tahoiyabot-01' || modelName === 'tahoiyabot-02');
	let stdoutWriter = null;
	const input = hiraganize(rawInput).replace(/[^\p{Script=Hiragana}ー]/gu, '');

	const stdoutPromise = new Promise((resolve) => {
		stdoutWriter = concatStream({encoding: 'buffer'}, (stdout) => {
			resolve(stdout);
		});
	});

	let stderrWriter = null;

	const stderrPromise = new Promise((resolve) => {
		stderrWriter = concatStream({encoding: 'buffer'}, (stderr) => {
			resolve(stderr);
		});
	});

	const modelPath = path.join(__dirname, 'models', modelName);
	const dockerVolumePath = path.sep === '\\' ? modelPath.replace('C:\\', '/c/').replace(/\\/g, '/') : modelPath;

	let container = null;

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
			Volumes: {
				'/root/model': {},
			},
			VolumesFrom: [],
			HostConfig: {
				Binds: [`${dockerVolumePath}:/root/model:ro`],
				Memory: 512 * 1024 * 1024,
			},
		});

		const stream = await container.attach({
			stream: true,
			stdout: true,
			stderr: true,
		});

		container.modem.demuxStream(stream, stdoutWriter, stderrWriter);
		stream.on('end', () => {
			stdoutWriter.end();
			stderrWriter.end();
		});

		await container.start();
		await container.wait();
		return container;
	};

	const runner = Promise.all([
		stdoutPromise,
		stderrPromise,
		executeContainer(),
	]);

	let stdout = null;
	let stderr = null;

	try {
		[stdout, stderr] = await Promise.race([
			runner,
			new Promise((resolve, reject) => {
				setTimeout(() => {
					reject(new TimeoutError());
				}, 60000);
			}),
		]);
	} finally {
		if (container) {
			await container.stop().catch((error) => {
				if (error.statusCode !== 304) {
					throw error;
				}
			});
			await container.remove().catch((error) => {
				if (error.statusCode !== 304) {
					throw error;
				}
			});
		}
	}

	const resultTokens = (stdout ? stdout.toString() : '').trim().split(' ');
	const result = resultTokens.reduce((previous, current) => {
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
		stdout: stdout ? stdout.toString() : '',
		stderr: stderr ? stderr.toString() : '',
	};
};
