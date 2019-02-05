const {stripIndent} = require('common-tags');
const {toZenKana} = require('jaconv');
const {katakanize} = require('japanese');
const {flatten, maxBy} = require('lodash');

const tokenize = require('./tokenize');
const {findDajare, listAlternativeReadings} = require('./dajare');

module.exports = ({rtmClient: rtm, webClient: slack}) => {
	const slackDecode = (text) => text
		.replace(/<[^>]+>/g, (link) => {
			const matches = (/^(.+)\|(.+)$/).exec(link);
			if (!matches) {
				return '';
			}
			return matches[2];
		})
		.replace(/&(lt|gt|amp);/g, (_s, str1) => ({
			amp: '&',
			lt: '<',
			gt: '>',
		}[str1]));

	const getTokenReading = (token) => {
		const {reading, surface_form, pronunciation} = token;
		return toZenKana(katakanize(pronunciation || reading || surface_form || ''))
			.replace(/(?![ー\uff70])\P{Script=Katakana}/gu, '');
	};

	const countMora = (text) => (
		(text.match(/.[ァィゥェォャュョヮ]?/g) || []).length
	);

	const getTokenPos = (readings, pos) => {
		let sum = 0;
		for (let i = 0; i < readings.length; i++) {
			const reading = readings[i];
			if (pos < sum + reading.length) {
				return [i, pos - sum];
			}
			sum += reading.length;
		}
		return [readings.length, pos - sum];
	};

	// eslint-disable-next-line max-params
	const getTokenSlice = (tokens, readings, index, length) => {
		const [start] = getTokenPos(readings, index);
		const [end] = getTokenPos(readings, index + length - 1);
		return tokens.slice(start, end + 1);
	};

	const getDajare = (readings, tokens) => {
		const moraLimit = (() => {
			const reading = readings.join('');
			if (reading.length < 10) {
				return 2;
			} else if (reading.length < 20) {
				return 3;
			}
			return 4;
		})();
		const dajares = listAlternativeReadings(readings)
			.map((replacedReadings) => {
				const reading = replacedReadings.join('');
				const dajare = findDajare(reading, moraLimit);
				if (!dajare) {
					return null;
				}
				if (countMora(dajare.word) < moraLimit) {
					return null;
				}
				return {
					readings: replacedReadings,
					...dajare,
				};
			})
			.filter((item) => item !== null);
		if (dajares.length === 0) {
			return null;
		}
		const dajare = maxBy(
			dajares,
			({word, indices}) => word.length * indices.length - indices.length * 0.2
		);
		return {
			...dajare,
			tokens,
			tokenSlices: dajare.indices
				.map((index) => getTokenSlice(tokens, dajare.readings, index, dajare.word.length)),
		};
	};

	const isTrivial = ({indices, word, readings, tokens}) => {
		if (new Set(indices.map((index) => {
			const [start, startOff] = getTokenPos(readings, index);
			const [end, endOff] = getTokenPos(readings, index + word.length - 1);
			const reading = readings.slice(start, end + 1).join(' ')
				.slice(startOff, (endOff + 1 - readings[end].length) || undefined)
				.replace(/\s{2,}/g, ' ');
			const completeStart = startOff === 0 ? start : start + 1;
			const completeEnd = endOff + 1 === readings[end].length ? end + 1 : end;
			const surface = tokens
				.slice(completeStart, completeEnd)
				.map((token, idx) => {
					// if (!getTokenReading(token)) {
					if (!readings[completeStart + idx]) {
						return '';
					}
					return token.surface_form;
				}).join('');
			return `${reading}\n${surface}`;
		})).size === 1) {
			return true;
		}
		if (indices.length === 2 && countMora(word) === 2 && indices[1] - indices[0] === word.length) {
			return true;
		}
		return false;
	};

	const evaluateDajare = (dajare) => {
		const {word, indices} = dajare;
		if ((/^(.ー*)\1*$/u).test(word) || (/^(..)\1{2,}$/u).test(word)) {
			// apparently not a dajare, such as あああああああああああああ, ほげほげほげほげほげほげ, or so
			return ':thinking_face:';
		}
		if (isTrivial(dajare)) {
			return ':thinking_face:';
		}
		const mora = countMora(word);
		if (mora >= 4 && indices.length > 2) {
			return ':flying-zabuton:';
		}
		if (mora * (indices.length + 3.0) <= 19.0) {
			return ':no-zabuton:';
		}
		if (mora * (indices.length + 3.0) > 30.0) {
			return ':zabutons:';
		}
		return ':zabuton:';
	};

	rtm.on('message', async (message) => {
		if (message.channel !== process.env.CHANNEL_SANDBOX && !message.channel.startsWith('D')) {
			return;
		}

		if (!message.text) {
			return;
		}

		if (message.username === 'dajare') {
			return;
		}

		if ((/^@dajare\s+/).test(message.text)) {
			const text = slackDecode(message.text.replace(/^@dajare\s+/, ''));
			if (!text || text.length > 300) {
				await slack.chat.postMessage({
					channel: message.channel,
					text: ':ha:',
					username: 'dajare',
					icon_emoji: ':zabuton:',
				});
				return;
			}
			const tokens = await tokenize(text);
			const readings = tokens.map(getTokenReading);
			const dajare = getDajare(readings, tokens);
			let response = '';
			if (dajare === null) {
				response = stripIndent`
					>${readings.join('')}
					評価: ダジャレではありません
				`;
			} else {
				const {indices, word, readings: altReadings, tokenSlices} = dajare;
				const insertions = flatten(indices.map((index) => [
					[index, ' *'],
					[index + word.length, '* '],
				])).reverse();
				let readingStr = altReadings.join('');
				for (const [pos, str] of insertions) {
					readingStr = readingStr.substring(0, pos) + str + readingStr.substring(pos);
				}

				const icon_emoji = evaluateDajare(dajare);
				const evaluation = `${icon_emoji}`;

				response = `${stripIndent`
					>${readingStr}
				`}\n${tokenSlices.map((tokenSlice, index) => stripIndent`
					表層形${index + 1}: ${tokenSlice.map((token) => token.surface_form).join(' ')}
				`).join('\n')}\n${stripIndent`
					評価: ${evaluation}
				`}`;
			}
			await slack.chat.postMessage({
				channel: message.channel,
				text: response,
				username: 'dajare',
				icon_emoji: ':zabuton:',
			});
			return;
		}

		if (message.text.length > 300) {
			return;
		}

		const text = slackDecode(message.text);
		const tokens = await tokenize(text);
		const dajare = getDajare(tokens.map(getTokenReading), tokens);
		if (dajare === null) {
			return;
		}
		const icon_emoji = evaluateDajare(dajare);
		if (icon_emoji === ':thinking_face:') {
			return;
		}

		// const response = hiraganize(word);
		// await slack.chat.postMessage({
		// 	channel: message.channel,
		// 	text: response,
		// 	username: 'dajare',
		// 	icon_emoji,
		// });
		await slack.reactions.add({
			name: icon_emoji.slice(1, -1),
			channel: message.channel,
			timestamp: message.ts,
		});
	});
};
