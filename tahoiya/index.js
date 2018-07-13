const {RTM_EVENTS: {MESSAGE}} = require("@slack/client")
const {stripIndent} = require('common-tags');
const axios = require('axios');
const download = require('download');
const get = require('lodash/get');
const sample = require('lodash/sample');
const path = require('path');
const fs = require('fs');
const {promisify} = require('util');

module.exports = async ({rtmClient: rtm, webClient: slack}) => {
	const state = {
		scrambles: [],
	};

	const databaseText = await (async () => {
		const dataPath = path.join(__dirname, 'data.txt');

		const dataExists = await new Promise((resolve) => {
			fs.access(dataPath, fs.constants.F_OK, (error) => {
				resolve(!Boolean(error));
			});
		});

		if (dataExists) {
			const databaseBuffer = await promisify(fs.readFile)(dataPath);
			return databaseBuffer.toString();
		}

		{
			const databaseBuffer = await download('https://john-smith.github.io/kana.tsv');
			await promisify(fs.writeFile)(dataPath, databaseBuffer);
			return databaseBuffer.toString();
		}
	})();

	const database = databaseText.split('\n').filter((line) => line.length !== 0).map((line) => line.split('\t'));

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

			if (text === 'たほいや') {
				const [word, ruby] = sample(database);
				const response = await axios.get('https://ja.wikipedia.org/w/api.php', {
					params: {
						action: 'query',
						prop: 'extracts',
						titles: word,
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
				console.log(wikitext);

				let onePhrase = null;
				const lines = wikitext.split('\n').filter((line) => line.trim().length !== 0);

				if (lines.length !== 1) {
					onePhrase = lines[1];
				} else {
					onePhrase = wikitext.replace(/\(.+?\)/g, '');
					onePhrase = onePhrase.replace(/（.+?）/g, '');
					if (onePhrase.includes('とは、')) {
						onePhrase = onePhrase.replace(/^.+?とは、/, '');
					} else if (onePhrase.includes('は、')) {
						onePhrase = onePhrase.replace(/^.+?は、/, '');
					} else if (onePhrase.includes('とは')) {
						onePhrase = onePhrase.replace(/^.+?とは/, '');
					} else if (onePhrase.includes('、')) {
						onePhrase = onePhrase.replace(/^.+?、/, '');
					} else {
						onePhrase = onePhrase.replace(/^.+?は/, '');
					}
					onePhrase = onePhrase.replace(/^.+?は、/, '');
					onePhrase = onePhrase.replace(/であり、.+$/, '');
					onePhrase = onePhrase.replace(/で、.+$/, '');
					onePhrase = onePhrase.replace(/(のこと|をいう|である|。)+$/, '');
				}

				await postMessage(`${word} (${ruby}) ${onePhrase}`);

				return;
			}
		} catch (error) {
			failed(error);
		}
	});
};
