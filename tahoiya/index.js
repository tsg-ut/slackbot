const {RTM_EVENTS: {MESSAGE}} = require("@slack/client")
const {stripIndent} = require('common-tags');
const axios = require('axios');
const get = require('lodash/get');

module.exports = ({rtmClient: rtm, webClient: slack}) => {
	const state = {
		scrambles: [],
	};

	rtm.on(MESSAGE, async (message) => {
		if (message.channel !== process.env.CHANNEL_SANDBOX) {
			return;
		}

		if (!message.text || message.subtype !== undefined) {
			return;
		}

		const postMessage = (text) => (
			slack.chat.postMessage(message.channel, text, {
				username: 'tahoiya',
				// eslint-disable-next-line camelcase
				icon_emoji: ':open_book:',
			})
		);

		const failed = (error) => (
			postMessage(error.stack)
		);

		try {
			const {text} = message;
			let match = null;

			if (text.startsWith('たほいや')) {
				const response = await axios.get('https://ja.wikipedia.org/w/api.php', {
					params: {
						action: 'query',
						prop: 'extracts',
						titles: text.slice(4),
						exlimit: 1,
						exintro: true,
						explaintext: true,
						exsentences: 1,
						format: 'json',
					},
					responseType: 'json',
				});

				const pages = get(response, ['data', 'query', 'pages']);
				if (typeof pages !== 'object') {
					await failed(new Error());
					return;
				}

				const wikitext = get(Object.values(pages), [0, 'extract']);
				if (typeof wikitext !== 'string' || wikitext.length === 0) {
					await failed(new Error());
					return;
				}

				let onePhrase = null;

				if (wikitext.split('\n').length !== 1) {
					onePhrase = wikitext.split('\n')[1];
				} else {
					onePhrase = wikitext.replace(/\(.+?\)/g, '');
					onePhrase = onePhrase.replace(/（.+?）/g, '');
					onePhrase = onePhrase.replace(/^.+?とは、/, '');
					onePhrase = onePhrase.replace(/^.+?は、/, '');
					onePhrase = onePhrase.replace(/である。$/, '');
					onePhrase = onePhrase.replace(/であり、.+$/, '');
					onePhrase = onePhrase.replace(/で、.+$/, '');
				}

				await postMessage(onePhrase);

				return;
			}
		} catch (error) {
			failed(error);
		}
	});
};
