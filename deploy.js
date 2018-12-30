require('dotenv').config();

const {WebClient} = require('@slack/client');
const {exec} = require('child_process');
const fs = require('fs');
const {promisify} = require('util');

const slack = new WebClient(process.env.SLACK_TOKEN);

(async () => {
	logger.info('$ git pull');
	const {stdout, stderr} = await promisify(exec)('git pull');
	logger.info(stdout, stderr);

	logger.info('$ touch .restart-trigger');
	logger.info((await promisify(exec)('touch .restart-trigger')).stdout);

	const rawHash = await promisify(fs.readFile)('.git/refs/heads/master');
	const hash = rawHash.toString().trim();
	slack.chat.postMessage(process.env.CHANNEL_SANDBOX, `Deployed <https://github.com/tsg-ut/slackbot/commit/${hash}|${hash}>`, {
		username: 'slackbot-deploy',
		// eslint-disable-next-line camelcase
		icon_emoji: ':muscle:',
	});
})().catch((error) => {
	logger.error(error);
});
