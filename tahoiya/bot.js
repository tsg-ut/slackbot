const Docker = require('dockerode');
const concatStream = require('concat-stream');
const {hiraganize} = require('japanese');
const path = require('path');

const docker = new Docker();

class TimeoutError extends Error { }

module.exports.getResult = async (rawInput) => {
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

	const modelPath = path.join(__dirname, 'model');
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
			Cmd: ['bash', '/root/run.sh', Array.from(input).join(' '), 'model.ckpt-455758'],
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
		result,
		stdout: stdout ? stdout.toString() : '',
		stderr: stderr ? stderr.toString() : '',
	};
};
