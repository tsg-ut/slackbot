const {RTM_EVENTS: {MESSAGE}} = require("@slack/client")
const {stripIndent} = require('common-tags');
const axios = require('axios');
const download = require('download');
const assert = require('assert');
const get = require('lodash/get');
const sample = require('lodash/sample');
const sampleSize = require('lodash/sampleSize');
const shuffle = require('lodash/shuffle');
const path = require('path');
const fs = require('fs');
const {promisify} = require('util');

module.exports = async ({rtmClient: rtm, webClient: slack}) => {
	const state = {
		phase: 'waiting',
		candidates: [],
		meanings: new Map(),
		theme: null,
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
	const candidateWords = database.filter(([word, ruby]) => 3 <= ruby.length && ruby.length <= 6);

	const colors = [
		'#F44336',
		'#7E57C2',
		'#0288D1',
		'#388E3C',
		'#F4511E',
		'#607D8B',
		'#EC407A',
		'#5C6BC0',
		'#00838F',
		'#558B2F',
		'#8D6E63',
		'#AB47BC',
		'#1E88E5',
		'#009688',
		'#827717',
		'#E65100',
	];

	const postMessage = (text, attachments) => (
		slack.chat.postMessage(process.env.CHANNEL_SANDBOX, text, {
			username: 'tahoiya',
			// eslint-disable-next-line camelcase
			icon_emoji: ':open_book:',
			...(attachments ? {attachments} : {}),
		})
	);

	const failed = (error) => (
		postMessage(error.stack)
	);

	rtm.on(MESSAGE, async (message) => {
		if (!message.text || message.subtype !== undefined) {
			return;
		}

		try {
			const {text} = message;
			let match = null;

			if (message.channel === process.env.CHANNEL_SANDBOX) {
				if (text === 'たほいや') {
					if (state.phase === 'waiting') {
						const candidates = sampleSize(candidateWords, 10);
						state.candidates = candidates;
						console.log(candidates);
						await postMessage(stripIndent`
							楽しい“たほいや”を始めるよ～:clap::clap::clap:
							下のリストの中からお題にする単語を選んでタイプしてね:wink:
						`, candidates.map(([, ruby], index) => ({
							text: ruby,
							color: colors[index],
						})));
						return;
					}

					if (state.phase === 'collect_meanings') {
						if (state.meanings.size === 0) {
							await postMessage('参加者がいないので始められないよ:face_with_rolling_eyes:');
							return;
						}

						if (process.env.NODE_ENV !== 'development' && state.meanings.size === 1) {
							await postMessage('参加者が1人じゃ始められないよ:unamused:');
							return;
						}

						state.phase = 'collect_bettings';

						const shuffledMeanings = shuffle([{
							player: null,
							text: state.theme.meaning,
						}, ...[...state.meanings.entries()].map(([player, text]) => ({
							player,
							text,
						}))]);

						await postMessage(stripIndent`
							ベッティングタイムが始まるよ～:clap::clap::clap:
							下のリストから *${state.theme.ruby}* の正しい意味だと思うものを選んで、
							「nにm枚」とタイプしてね:wink:
						`, shuffledMeanings.map((meaning, index) => ({
							text: `${index + 1}. ${meaning.text}`,
							color: colors[index],
						})));
						return;
					}
				}

				if (state.candidates.some(([, ruby]) => ruby === text)) {
					assert(state.phase === 'waiting');
					state.phase = 'collect_meanings';

					const [word, ruby] = state.candidates.find(([, ruby]) => ruby === text);
					state.candidates = [];

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

					let meaning = null;
					const lines = wikitext.split('\n').filter((line) => line.trim().length !== 0);

					if (lines.length !== 1) {
						meaning = lines[1];
					} else {
						meaning = wikitext.replace(/\(.+?\)/g, '');
						meaning = meaning.replace(/（.+?）/g, '');
						if (meaning.includes('とは、')) {
							meaning = meaning.replace(/^.+?とは、/, '');
						} else if (meaning.includes('は、')) {
							meaning = meaning.replace(/^.+?は、/, '');
						} else if (meaning.includes('とは')) {
							meaning = meaning.replace(/^.+?とは/, '');
						} else if (meaning.includes('、')) {
							meaning = meaning.replace(/^.+?、/, '');
						} else {
							meaning = meaning.replace(/^.+?は/, '');
						}
						meaning = meaning.replace(/^.+?は、/, '');
						meaning = meaning.replace(/であり、.+$/, '');
						meaning = meaning.replace(/で、.+$/, '');
						meaning = meaning.replace(/(のこと|をいう|である|。)+$/, '');
					}

					state.theme = {
						word,
						ruby,
						meaning,
					};

					await postMessage(stripIndent`
						お題を *「${ruby}」* にセットしたよ:v:
						参加者はこの単語の意味を考えて <@${process.env.USER_TSGBOT}> にDMしてね:relaxed:
						全員ぶん揃ったらこのチャンネルでもう一度「たほいや」とタイプしてね:+1:
					`);

					return;
				}
			}

			// DM
			if (message.channel.startsWith('D')) {
				if (state.phase === 'collect_meanings') {
					state.meanings.set(message.user, text);

					await slack.chat.postMessage(message.channel, ':+1:', {
						username: 'tahoiya',
						// eslint-disable-next-line camelcase
						icon_emoji: ':open_book:',
					});

					await postMessage(stripIndent`
						<@${message.user}> が意味を登録したよ:muscle:
						現在の参加者: ${state.meanings.size}人
					`);
					return;
				}
			}
		} catch (error) {
			failed(error);
		}
	});
};
