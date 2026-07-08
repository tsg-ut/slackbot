import fs from 'fs';
import path from 'path';
import assert from 'assert';
import {promisify} from 'util';
import querystring from 'querystring';
import {stripIndent} from 'common-tags';
import {JSDOM} from 'jsdom';
import axios from 'axios';
import moment from 'moment';
import {sampleSize} from 'lodash-es';
import byline from 'byline';
import w2v from 'word2vec';
import {download} from '../lib/download';
import type {SlackInterface} from '../lib/slack';
import type {GenericMessageEvent} from '@slack/bolt';

export default async ({eventClient, webClient: slack}: SlackInterface) => {
	const state: {
		phase: string;
		theme: string | null;
		candidates: string[];
		ans: Map<string, string>;
	} = (() => {
		try {
			// eslint-disable-next-line global-require
			const savedState = require('./state.json');
			return {
				phase: savedState.phase,
				theme: savedState.theme || null,
				candidates: savedState.candidates || [],
				ans: new Map(Object.entries(savedState.ans)),
			};
		} catch (e) {
			return {
				phase: 'waiting', // waiting, collecting,
				theme: null as string | null,
				candidates: [] as string[],
				ans: new Map(),
			};
		}
	})();

	const mapToObject = (map: Map<string, string>) => {
		const object: {[key: string]: string} = {};
		for (const [key, value] of map.entries()) {
			if (!key) {
				continue;
			}
			object[key.toString()] = value;
		}
		return object;
	};

	const setState = async (newState: Partial<typeof state>) => {
		Object.assign(state, newState);

		const savedState: {[key: string]: any} = {};
		for (const [key, value] of Object.entries(state)) {
			if (value instanceof Map) {
				savedState[key] = mapToObject(value);
			} else {
				savedState[key] = value;
			}
		}

		await promisify(fs.writeFile)(path.join(import.meta.dirname, 'state.json'), JSON.stringify(savedState));
	};

	const {members} = await slack.users.list({});
	const {team} = await slack.team.info();

	const getMemberIcon = (user: string) => {
		const member = members.find(({id}) => id === user);
		return member.profile.image_24;
	};

	const genColorRGB = (H: number): [number, number, number] => {
		const C = 0.5;
		const Hp = H / 60;
		const X = C * (1 - Math.abs(Hp % 2 - 1));
		let B = 0;
		let G = 0;
		let R = 0;

		if (0 <= Hp && Hp < 1) {
			[R, G, B] = [C, X, 0];
		}
		if (1 <= Hp && Hp < 2) {
			[R, G, B] = [X, C, 0];
		}
		if (2 <= Hp && Hp < 3) {
			[R, G, B] = [0, C, X];
		}
		if (3 <= Hp && Hp < 4) {
			[R, G, B] = [0, X, C];
		}
		if (4 <= Hp && Hp < 5) {
			[R, G, B] = [X, 0, C];
		}
		if (5 <= Hp && Hp < 6) {
			[R, G, B] = [C, 0, X];
		}

		const m = 1 - C;
		[R, G, B] = [R + m, G + m, B + m];

		R = Math.floor(R * 255);
		G = Math.floor(G * 255);
		B = Math.floor(B * 255);

		return [R, G, B];
	};

	const genColorHex = (i: number) => genColorRGB(i * 101 % 360).map((v) => (`0${v.toString(16)}`).slice(-2)).join('');

	const getTimeLink = (time: number) => {
		const text = moment(time).utcOffset('+0900').format('HH:mm:ss');
		const url = `https://www.timeanddate.com/countdown/generic?${querystring.stringify({
			iso: moment(time).utcOffset('+0900').format('YYYYMMDDTHHmmss'),
			p0: 248,
			msg: '弓箭登録終了まで',
			font: 'sansserif',
			csz: 1,
		})}`;
		return `<${url}|${text}>`;
	};

	const postMessage = (text: string, attachments?: any[], options?: any) => (
		slack.chat.postMessage({
			channel: process.env.CHANNEL_SANDBOX,
			text,
			username: 'vocabwar',
			icon_emoji: ':bow_and_arrow:',
			...(attachments ? {attachments} : {}),
			...(options ? options : {}),
		})
	);

	const failed = (error: Error) => (
		postMessage(error.stack)
	);

	const getMeaning = async (word: string) => {
		try {
			const res = await axios.get(`https://kotobank.jp/word/${encodeURIComponent(word)}`);
			const dom = new JSDOM(res.data);
			const el = dom.window.document.querySelector('section.description');
			return el?.textContent?.replace(/[ \t\n]/g, '').match(/(.+?)。/)?.[1] ?? '';
		} catch (e) {
			return '';
		}
	};

	let freq: {[key: string]: number} = {};
	let ad: {[key: string]: number} = {};

	const normalizedFreq = (word: string) => Math.atan(freq[word]) / Math.PI * 2;

	const genWordList = (n: number) => sampleSize(Object.keys(ad), n);

	const genTheme = (n: number) => {
		const res = new Set<string>();
		do {
			const nres = genWordList(n - res.size);
			for (const word of nres) {
				if (Math.random() < 1 - normalizedFreq(word)) {
					res.add(word);
				}
			}
		} while (res.size < n);
		return Array.from(res).slice(0, n);
	};

	const genDummy = (n: number) => {
		const res = new Set<string>();
		do {
			const nres = sampleSize(Object.keys(ad), n - res.size);
			for (const word of nres) {
				if (Math.random() < normalizedFreq(word)) {
					res.add(word);
				}
			}
		} while (res.size < n);
		return Array.from(res).slice(0, n);
	};

	const addDummy = () => {
		const ret: [string | null, string][] = [];
		for (const [user, word] of state.ans.entries()) {
			ret.push([user, word]);
		}
		for (const word of genDummy(state.ans.size * 2)) {
			ret.push([null, word]);
		}
		return ret;
	};

	const loadFrqData = async (filepath: string): Promise<{[key: string]: number}> => new Promise((resolve, reject) => {
		const rs = fs.createReadStream(filepath, {encoding: 'utf-8'});
		const stream = byline.createStream(rs);
		const res: {[key: string]: number} = {};

		stream.on('data', (line: string) => {
			const tmp = line.toString().split(' ');
			res[tmp[0]] = parseFloat(tmp[1]);
		});

		stream.on('finish', () => {
			resolve(res);
		});

		stream.on('error', (err: Error) => {
			reject(err);
		});
	});

	if (!await new Promise((resolve) => {
		fs.access(path.join(import.meta.dirname, 'data'), fs.constants.F_OK, (error) => {
			resolve(!error);
		});
	})) {
		await promisify(fs.mkdir)(path.join(import.meta.dirname, 'data'));
	}

	await Promise.all(
		[
			['ad.txt', 'https://drive.google.com/uc?id=1hlIeHy-ilaAfCicjaH0x5bjU_8rjx-Ju'],
			['frequency.txt', 'https://drive.google.com/uc?id=1dtkJPTbH7xVRov77h8OBJ3wLsBaNPMNV'],
			['wiki_wakati.wv', 'https://dl.dropboxusercontent.com/s/7laifmbdq4oqks9/wiki_wakati.wv'],
		// eslint-disable-next-line require-await
		].map(async ([filename, url]) => download(path.join(import.meta.dirname, 'data', filename), url))
	);
	freq = await loadFrqData(path.join(import.meta.dirname, 'data', 'frequency.txt'));
	ad = await loadFrqData(path.join(import.meta.dirname, 'data', 'ad.txt'));
	const model: any = await promisify((w2v as any).loadModel)({file: path.join(import.meta.dirname, 'data', 'wiki_wakati.wv'), is_binary: true});

	const onFinish = async () => {
		assert(state.phase === 'collecting');
		setState({phase: 'waiting'});
		const calcPoint = (word: string) => {
			const i = sim.findIndex((x) => x[2] === word);
			if (i < state.ans.size) {
				return [(sim[i][0] ** 3) * (freq[word] ** 3) / 3 / 4, freq[word]];
			}
			return [-1 / sim[i][0], freq[word]];
		};
		const words = addDummy();

		let sim: [number, string | null, string][] = [];
		for (const [user, word] of words) {
			sim.push([(model.similarity(state.theme, word) + 1) / 2, user, word]);
		}

		sim = sim.sort((a, b) => a[0] - b[0]);
		const genAttachments = async () => (
			Promise.all(sim.map(async ([s, user, word], index) => {
				const [point, frq] = calcPoint(word);
				const meaning = await getMeaning(word);
				return {
					author_name: `#${index + 1}: ${user ? `<@${user}>` : '-'}`,
					author_link: user ? `https://${team.domain}.slack.com/team/${user}` : undefined,
					author_icon: user ? getMemberIcon(user) : undefined,
					title: `${word} (${(point >= 0 ? '+' : '') + point.toFixed(1)}点)`,
					title_link: `https://kotobank.jp/word/${encodeURIComponent(word)}`,
					text: stripIndent`
                        ${meaning}
                        類似度: ${s.toFixed(2)}, レア度: ${frq.toFixed(2)}
                    `,
					color: point > 0 ? genColorHex(index) : '#777777',
					footer: meaning ? 'コトバンク' : undefined,
				};
			}))
		);
		const attachments = await genAttachments();
		const meaning = await getMeaning(state.theme);
		await postMessage(stripIndent`
            :confetti_ball::trophy:結果発表〜！:trophy::confetti_ball:
            お題: *${state.theme}*
            ${meaning ? `意味: ${meaning}` : ''}
            `, attachments);
		await setState({
			phase: 'waiting',
			ans: new Map(),
			theme: null,
		});
	};

	eventClient.on('message', async (message: GenericMessageEvent) => {
		if (!message.text || message.subtype !== undefined) {
			return;
		}
		try {
			let {text} = message;
			if (message.channel === process.env.CHANNEL_SANDBOX) {
				text = text.trim();

				if (text === '即弓箭') {
					if (state.phase !== 'waiting') {
						await postMessage(':fire:弓箭中だよ:fire:');
						return;
					}
					await setState({candidates: []});
					await setState({phase: 'collecting'});
					await setState({theme: genTheme(1)[0]});
					const end = Date.now() + 0.5 * 60 * 1000;
					setTimeout(onFinish, 0.5 * 60 * 1000);
					await postMessage(stripIndent`
                        語彙力の戦い:fire:*弓箭*:fire:を始めるよ:bow_and_arrow:
                        お題は「 *${state.theme}* 」:muscle:
                        参加者は30秒以内にこの単語に“近い”単語を<#${process.env.CHANNEL_SANDBOX}|sandbox>に書き込んでね:crossed_swords:
                        終了予定時刻: ${getTimeLink(end)}
                    `);
					return;
				}
				if (text === '弓箭') {
					if (state.phase !== 'waiting') {
						await postMessage(':fire:弓箭中だよ:fire:');
						return;
					}

					const candidates = genTheme(10);
					await setState({candidates});
					await postMessage(stripIndent`
                        語彙力の戦い:fire:*弓箭*:fire:を始めるよ:bow_and_arrow:
                        :point_down:お題を選んでね:point_down:
                    `, candidates.map((ruby, index) => ({
						text: ruby,
						color: genColorHex(index),
					})));
					return;
				}
				if (text.startsWith('弓箭')) {
					const word = text.slice(2).trim();

					if (state.phase !== 'waiting') {
						await postMessage(':fire:弓箭中だよ:fire:');
						return;
					}
					if (!model.getVector(word) || !(word in freq)) {
						await postMessage(`「${word}」はぼくも知らないよ:cry:`);
						return;
					}
					await setState({candidates: []});
					await setState({phase: 'collecting'});
					state.theme = word;
					const end = Date.now() + 0.5 * 60 * 1000;
					setTimeout(onFinish, 0.5 * 60 * 1000);
					await postMessage(stripIndent`
                        語彙力の戦い:fire:*弓箭*:fire:を始めるよ:bow_and_arrow:
                        お題は「 *${state.theme}* 」:muscle:
                        参加者は30秒以内にこの単語に“近い”単語を<#${process.env.CHANNEL_SANDBOX}|sandbox>に書き込んでね:crossed_swords:
                        終了予定時刻: ${getTimeLink(end)}
                    `);
					return;
				}
				if (state.candidates.some((word) => word === text)) {
					assert(state.phase === 'waiting');
					await setState({phase: 'collecting'});

					const word = text;
					await setState({candidates: []});

					await setState({theme: word});

					const end = Date.now() + 0.5 * 60 * 1000;
					setTimeout(onFinish, 0.5 * 60 * 1000);

					await postMessage(stripIndent`
                        お題 *「${word}」* に決定:bow_and_arrow:
                        参加者は30秒以内にこの単語に"近い"単語を<#${process.env.CHANNEL_SANDBOX}|sandbox>に書き込んでね:crossed_swords:
                        終了予定時刻: ${getTimeLink(end)}
                    `);
					return;
				}

				if (state.phase === 'collecting' && text.length <= 256) {
					if (!model.getVector(text) || !(text in freq)) {
						await postMessage(`「${text}」はぼくも知らないよ:cry:`);
						return;
					}
					if (state.theme === text) {
						await postMessage(`「${text}」はお題じゃん:angry:`);
						return;
					}
					if (Array.from(state.ans.values()).indexOf(text) !== -1) {
						await postMessage(`「${text}」をパクるのはだめだよ:rage:`);
						return;
					}
					state.ans.set(message.user, text);
					await setState({ans: state.ans});
					await slack.reactions.add({name: '+1', channel: message.channel, timestamp: message.ts});
				}
			}
		} catch (e) {
			failed(e as Error);
		}
	});
};
