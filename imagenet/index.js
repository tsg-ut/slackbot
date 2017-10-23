const Docker = require('dockerode');
const tmp = require('tmp');
const concatStream = require('concat-stream');
const axios = require('axios');
const {stripIndent, stripIndents} = require('common-tags');
const path = require('path');
const {promisify} = require('util');
const fs = require('fs');
const url = require('url');
const {RTM_EVENTS: {MESSAGE}} = require('@slack/client');
const labelData = require('./labels');

const docker = new Docker();

class TimeoutError extends Error { }

module.exports = (clients) => {
	const {rtmClient: rtm, webClient: slack} = clients;

	rtm.on(MESSAGE, async (message) => {
		if (message.channel !== process.env.CHANNEL_SANDBOX) {
			return;
		}

		const {imageURL, ts, file} = (() => {
			if (!message.subtype && Array.isArray(message.attachments)) {
				const attachment = message.attachments.find((a) => a.image_url);
				if (attachment) {
					return {
						imageURL: attachment.image_url,
						ts: message.ts,
						file: null,
					};
				}
			}

			if (message.subtype === 'message_changed' && Array.isArray(message.message.attachments)) {
				const attachment = message.message.attachments.find((a) => a.image_url);
				if (attachment) {
					return {
						imageURL: attachment.image_url,
						ts: message.message.ts,
						file: null,
					};
				}
			}

			if (message.subtype === 'file_share') {
				if (message.file.mimetype.startsWith('image')) {
					return {
						imageURL: message.file.url_private,
						ts: null,
						file: message.file.id,
					};
				}
			}

			return {};
		})();

		if (!imageURL) {
			return;
		}

		console.log('image URL:', imageURL);

		const {path: tmpPath, cleanup} = await new Promise((resolve, reject) => {
			tmp.dir({unsafeCleanup: true}, (error, path, cleanup) => {
				if (error) {
					reject(error);
				} else {
					resolve({path, cleanup});
				}
			});
		});

		console.log('temp path:', tmpPath);

		const response = await axios({
			url: imageURL,
			method: 'get',
			...(url.parse(imageURL).host === 'files.slack.com' && {
				headers: {
					Authorization: `Bearer ${process.env.SLACK_TOKEN}`,
				},
			}),
			responseType: 'arraybuffer',
			timeout: 5000,
		});

		if (!['image/png', 'image/jpeg'].includes(response.headers['content-type'])) {
			cleanup();
			return;
		}

		const imageFile = `image.${response.headers['content-type'].split('/')[1]}`;
		const fixturePath = path.resolve(__dirname, 'fixtures');

		await promisify(fs.writeFile)(path.resolve(tmpPath, imageFile), response.data);
		await promisify(fs.writeFile)(path.resolve(tmpPath, 'script.py'), stripIndent`
			import json
			import caffe
			import numpy as np
			net = caffe.Classifier('/fixtures/deploy.prototxt', '/fixtures/resnet50_cvgj_iter_320000.caffemodel', raw_scale=255, image_dims=(256, 256))
			image = caffe.io.load_image('/volume/${imageFile}')
			pred = net.predict([image], oversample=False)
			print(json.dumps([np.argsort(pred[0]).tolist(), np.sort(pred[0]).tolist()]))
		`);

		await new Promise((resolve) => setTimeout(resolve, 10000));

		let stdoutWriter = null;

		const stdoutPromise = new Promise((resolve) => {
			stdoutWriter = concatStream((stdout) => {
				resolve(stdout);
			});
		});

		let stderrWriter = null;

		const stderrPromise = new Promise((resolve) => {
			stderrWriter = concatStream((stderr) => {
				resolve(stderr);
			});
		});

		const dockerVolumePath = path.sep === '\\' ? tmpPath.replace('C:\\', '/c/').replace(/\\/g, '/') : tmpPath;
		const dockerFixturePath = path.sep === '\\' ? fixturePath.replace('C:\\', '/c/').replace(/\\/g, '/') : fixturePath;

		const executeContainer = async () => {
			const container = await docker.createContainer({
				Hostname: '',
				User: '',
				AttachStdin: false,
				AttachStdout: true,
				AttachStderr: true,
				Tty: false,
				OpenStdin: false,
				StdinOnce: false,
				Env: null,
				Cmd: ['python', '/volume/script.py'],
				Image: 'bvlc/caffe:cpu',
				Volumes: {
					'/volume': {},
				},
				VolumesFrom: [],
				HostConfig: {
					Binds: [
						`${dockerVolumePath}:/volume`,
						`${dockerFixturePath}:/fixtures`,
					],
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
			await container.remove();
		};

		const runner = Promise.all([
			stdoutPromise,
			stderrPromise,
			executeContainer(),
		]);

		const [stdout, stderr] = await Promise.race([
			runner,
			new Promise((resolve, reject) => {
				setTimeout(() => {
					reject(new TimeoutError());
				}, 60000);
			}),
		]);

		cleanup();

		const [labels, possibilities] = JSON.parse(stdout);

		const text = stripIndents`
			ImageNet Prediction:
			${labels.reverse().slice(0, 5).map((label, index) => (
		`${index + 1}. (${possibilities[possibilities.length - index - 1].toFixed(4)}) ${labelData[label]}`
	)).join('\n')}
		`;

		if (file) {
			await slack.files.comments.add(file, text);
		} else {
			await slack.chat.postMessage(message.channel, text, {
				username: 'imagenet',
				// eslint-disable-next-line camelcase
				icon_emoji: ':frame_with_picture:',
				...(ts && {
					thread_ts: ts,
					reply_broadcast: true,
				}),
			});
		}
	});
};
