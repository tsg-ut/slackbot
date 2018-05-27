const Docker = require('dockerode');
const concatStream = require('concat-stream');
const {RTM_EVENTS: {MESSAGE}} = require('@slack/client');
const cloudinary = require('cloudinary');

const docker = new Docker();

class TimeoutError extends Error { }

module.exports = (clients) => {
	const {rtmClient: rtm, webClient: slack} = clients;

	rtm.on(MESSAGE, async (message) => {
		if (message.channel !== process.env.CHANNEL_SANDBOX) {
			return;
		}

		if (message.subtype !== undefined) {
			return;
		}

		if (!message.text || !message.text.match(/^[\d\w\s()+\-*/!^'":<>,$=#.%[\]]+$/)) {
			return;
		}

		let stdoutWriter = null;

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
				Cmd: ['bash', '/root/build.sh', message.text],
				Image: 'hakatashi/slackbot_math',
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

		try {
			const [stdout, stderr] = await Promise.race([
				runner,
				new Promise((resolve, reject) => {
					setTimeout(() => {
						reject(new TimeoutError());
					}, 10000);
				}),
			]);

			if (stderr && stderr.length > 0) {
				console.error('stderr:', stderr.toString());
				return;
			}

			const result = await new Promise((resolve, reject) => {
				cloudinary.v2.uploader.upload_stream({resource_type: 'image'}, (error, data) => {
					if (error) {
						reject(error);
					} else {
						resolve(data);
					}
				}).end(stdout);
			});

			const url = result.secure_url;
			await slack.chat.postMessage(process.env.CHANNEL_SANDBOX, `${message.text} =`, {
				username: 'math',
				icon_emoji: ':computer:',
				attachments: [
					{
						image_url: url,
						fallback: '',
					},
				],
			});
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
	});
};
