import {promises as fs} from 'fs';
import path from 'path';
import {Mutex} from 'async-mutex';
import levenshtein from 'fast-levenshtein';
// @ts-expect-error: Missing types
import {hiraganize} from 'japanese';
// @ts-expect-error: Missing types
import {tokenize} from 'kuromojin';
import {escapeRegExp, sample, sampleSize, chunk, uniq, sortBy, shuffle} from 'lodash';
// @ts-expect-error: Missing types
import scrapeIt from 'scrape-it';
import {unlock, increment} from '../achievements';
import {Deferred} from '../lib/utils';
import {getSongInfo, getMovieInfo} from '../lyrics/index';
import {loadSheet} from './index';
import type {GenericMessageEvent} from '@slack/web-api';
import {ChannelLimitedBot} from '../lib/channelLimitedBot';
import {SlackInterface} from '../lib/slack';

const freqDeferred = new Deferred<Map<string, number>>();
const mutex = new Mutex();

interface Token {
	pos: string;
	word_type: string;
	basic_form: string;
	surface_form: string;
}

interface SongInfo {
	title: string;
	utaNetUrl: string;
	paragraphs: string[];
	tokens: Token[];
	type: string;
	movie: string;
	animeTitle: string;
	forbiddenWords: string[];
}

interface QuizState {
	answer: string | null;
	previousTick: number;
	previousHint: number;
	hints: any[];
	songInfos: SongInfo[];
	thread: string | null;
	difficulty: string | null;
	channel: string | null;
}

const loadFreq = async (): Promise<Map<string, number>> => {
	if (freqDeferred.isResolved) {
		return freqDeferred.promise;
	}

	const data = await fs.readFile(path.resolve(__dirname, '../vocabwar/data/frequency.txt'));
	const freq = new Map(data.toString().split('\n').filter((line) => line).map((line) => {
		const [word, frequency] = line.split(' ');
		return [word, parseFloat(frequency)];
	}));
	freqDeferred.resolve(freq);
	return freq;
};

const getHintText = (n: number) => {
	if (n <= 1) {
		return 'しょうがないにゃあ、ヒントだよ';
	}
	if (n <= 2) {
		return 'もう一つヒントだよ、早く答えてね';
	}
	if (n <= 3) {
		return 'まだわからないの？ヒント追加するからね';
	}
	return '最後のヒントだよ！もうわかるよね？';
};

const getSongInfos = async (title: string): Promise<SongInfo[]> => {
	const {animeInfos} = await loadSheet();
	const anime = animeInfos.find(({name}) => name === title);
	if (!anime || !anime.utanetId) {
		return [];
	}
	const utanetUrl = `https://www.uta-net.com/user/search/anime_list_2.html?tno=${anime.utanetId}`;
	const {data: {songs}} = await scrapeIt(utanetUrl, {
		songs: {
			listItem: '.list_title + table + table tr',
			data: {
				title: 'td:nth-child(1)',
				link: {
					selector: 'td:nth-child(1) a',
					attr: 'href',
					convert: (link: string) => new URL(link, utanetUrl).href,
				},
				artist: 'td:nth-child(2)',
				type: 'td:nth-child(3)',
			},
		},
	});
	const songInfos: SongInfo[] = [];
	for (const song of shuffle(songs)) {
		if (song.type !== 'OP' && song.type !== 'ED') {
			continue;
		}
		const songInfo = await getSongInfo(song.link, '');
		const movieInfo = await getMovieInfo(songInfo.utaNetUrl.replace('song', 'movie'));
		songInfo.tokens = await tokenize(songInfo.paragraphs.join('\n'));
		songInfo.type = song.type;
		songInfo.movie = `https://youtu.be/${movieInfo.id}`;
		songInfo.animeTitle = title;

		songInfo.forbiddenWords = uniq([
			...songInfo.title.split(/\P{Letter}+/u),
			...songInfo.animeTitle.split(/\P{Letter}+/u),
		]).filter((word) => word.length > 2).sort((a, b) => b.length - a.length);

		songInfos.push(songInfo);
		break;
	}
	return songInfos;
};

const mask = (text: string, words: string[]) => {
	let response = text;
	for (const word of words) {
		response = response.replace(new RegExp(escapeRegExp(word), 'igu'), '█'.repeat(word.length));
	}
	return response;
};

const getHint = async (songInfos: SongInfo[], n: number): Promise<string> => {
	const songInfo = sample(songInfos)!;

	if (n === 0) {
		const nouns = songInfo.tokens.filter((token) => (
			token.pos === '名詞' &&
			!songInfo.forbiddenWords.includes(token.surface_form)
		));
		return chunk(sampleSize(uniq(nouns.map((noun) => noun.basic_form)), 10), 5)
			.map((hints) => hints.map((hint) => `＊${hint}＊`).join(' / '))
			.join('\n');
	}
	if (n === 1) {
		const freq = await loadFreq();
		const words = songInfo.tokens.filter((token) => (
			token.word_type === 'KNOWN' &&
			['名詞', '動詞', '形容詞'].includes(token.pos) &&
			!songInfo.forbiddenWords.includes(token.surface_form)
		));
		const sortedWords = sortBy(uniq(words.map((word) => word.basic_form)), (word) => {
			if (freq.has(word)) {
				return freq.get(word);
			}
			return Infinity;
		}).reverse();
		return chunk(sortedWords.slice(0, 20), 5)
			.map((hints) => hints.map((hint) => `＊${hint}＊`).join(' / '))
			.join('\n');
	}
	if (n === 2) {
		const sentences = sampleSize(songInfo.paragraphs.join('\n').split(/\s+/), 5);
		return sentences.map((sentence) => `＊${mask(sentence, songInfo.forbiddenWords)}＊`).join('\n');
	}
	if (n === 3 || n === 4) {
		const paragraph = sample(songInfo.paragraphs)!;
		return paragraph.split('\n').map((line) => `＊${mask(line, songInfo.forbiddenWords)}＊`).join('\n');
	}
	return '';
};

class AnimeSongQuizBot extends ChannelLimitedBot {
	protected override readonly wakeWordRegex = /^アニソン当てクイズ(?:easy|normal|hard)?$/u;

	protected override readonly username = 'anime';

	protected override readonly iconEmoji = ':tv:';

	private state: QuizState = {
		answer: null,
		previousTick: 0,
		previousHint: 0,
		hints: [],
		songInfos: [],
		thread: null,
		difficulty: null,
		channel: null,
	};

	private intervalId: NodeJS.Timeout | null = null;

	constructor(
		protected readonly slackClients: SlackInterface,
	) {
		super(slackClients);
		this.startTicker();
	}

	private startTicker() {
		this.intervalId = setInterval(() => {
			this.onTick();
		}, 1000);
	}

	private onTick() {
		mutex.runExclusive(async () => {
			const now = Date.now();
			const nextHint = this.state.previousHint + (this.state.hints.length === 5 ? 30 : 15) * 1000;

			if (this.state.answer !== null && nextHint <= now) {
				this.state.previousHint = now;
				if (this.state.hints.length < 5) {
					const hintText = getHintText(this.state.hints.length);
					const hint = await getHint(this.state.songInfos, this.state.hints.length);

					await this.postMessage({
						channel: this.state.channel!,
						text: `${hintText}\n\n${hint}`,
						thread_ts: this.state.thread!,
					});

					this.state.hints.push({});
				} else {
					const anger = sample([
						'これくらい常識だよね？',
						'なんでこんな簡単なこともわからないの？',
						'次は絶対正解してよ？',
						'やる気が足りないんじゃない？',
						'もっと集中して！',
					]);
					const songInfo = this.state.songInfos[0];
					await this.postMessage({
						channel: this.state.channel!,
						text: `もう、しっかりして！\n答えは ＊${songInfo.title}＊ (${this.state.answer} ${songInfo.type}) だよ:anger:\n${anger}\n\n${songInfo.movie}`,
						thread_ts: this.state.thread!,
						reply_broadcast: true,
						unfurl_links: true,
					});
					await this.postMessage({
						channel: this.state.channel!,
						text: songInfo.utaNetUrl,
						thread_ts: this.state.thread!,
						unfurl_links: true,
					});

					await this.deleteProgressMessage(this.state.thread!);

					this.state.answer = null;
					this.state.previousHint = 0;
					this.state.hints = [];
					this.state.thread = null;
					this.state.difficulty = null;
					this.state.channel = null;
				}
			}
			this.state.previousTick = now;
		});
	}

	protected override onWakeWord(message: GenericMessageEvent, channel: string): Promise<string | null> {
		const quizMessageDeferred = new Deferred<string | null>();

		const matches = (message.text as string).match(/^アニソン当てクイズ(?<difficulty>easy|normal|hard)?$/);
		if (matches && this.state.answer === null) {
			const difficulty = matches.groups?.difficulty || 'easy';

			mutex.runExclusive(async () => {
				const {animes, easyAnimes, normalAnimes} = await loadSheet();
				const animeTitles = uniq(animes.map(({animeTitle}) => animeTitle).filter((title) => title));
				let answer: string | undefined = undefined;
				if (difficulty === 'easy' || difficulty === 'extreme') {
					answer = sample(easyAnimes);
				} else if (difficulty === 'normal') {
					answer = sample(normalAnimes);
				} else {
					answer = sample(animeTitles);
				}

				const songInfos = await getSongInfos(answer!);

				if (songInfos.length === 0) {
					await this.postMessage({
						channel,
						text: `エラー:cry:\nアニメ: ${answer}`,
					});
					quizMessageDeferred.resolve(null);
					return;
				}

				const {ts} = await this.postMessage({
					channel,
					text: `このアニソンなーんだ\n\n${await getHint(songInfos, 0)}`,
				});

				this.state.songInfos = songInfos;
				this.state.thread = ts!;
				this.state.channel = channel;
				this.state.hints.push({});
				this.state.previousHint = Date.now();
				this.state.difficulty = difficulty;

				await this.postMessage({
					channel,
					text: '15秒経過でヒントを出すよ♫',
					thread_ts: ts!,
				});

				this.state.answer = answer!;
				quizMessageDeferred.resolve(ts!);
			}).catch((error: unknown) => {
				this.log.error('Failed to start anime song quiz', error);
				const errorText =
					error instanceof Error && error.stack !== undefined
						? error.stack : String(error);
				this.postMessage({
					channel,
					text: `エラー😢\n\`${errorText}\``,
				});
				quizMessageDeferred.resolve(null);
			});

			return quizMessageDeferred.promise;
		}

		quizMessageDeferred.resolve(null);
		return quizMessageDeferred.promise;
	}

	protected override async onMessageEvent(event: any) {
		// Call parent method to handle wake word detection
		await super.onMessageEvent(event);

		// Handle answers in thread
		const message = event;
		if (this.state.answer !== null && message.text && message.thread_ts === this.state.thread && message.username !== 'anime') {
			mutex.runExclusive(async () => {
				if (this.state.answer === null) {
					return;
				}
				const songInfo = this.state.songInfos[0];
				const answer = hiraganize(this.state.answer.replace(/\P{Letter}/gu, '').toLowerCase());
				const songName = hiraganize(songInfo.title.replace(/\P{Letter}/gu, '').toLowerCase());
				const userAnswer = hiraganize(message.text.replace(/\P{Letter}/gu, '').toLowerCase());

				const distance1 = levenshtein.get(answer, userAnswer);
				const distance2 = levenshtein.get(songName, userAnswer);

				if (distance1 <= answer.length / 3 || distance2 <= songName.length / 3) {
					await this.postMessage({
						channel: this.state.channel!,
						text: `<@${message.user}> 正解:tada:\n答えは ＊${songInfo.title}＊ (${this.state.answer} ${songInfo.type}) だよ:muscle:\n\n${songInfo.movie}`,
						thread_ts: this.state.thread!,
						reply_broadcast: true,
						unfurl_links: true,
					});
					await this.postMessage({
						channel: this.state.channel!,
						text: songInfo.utaNetUrl,
						thread_ts: this.state.thread!,
						unfurl_links: true,
					});

					const {animeInfos} = await loadSheet();
					const animeInfo = animeInfos.find(({name}) => name === this.state.answer);
					await increment(message.user, 'anime-song-answer');
					if (this.state.hints.length === 1) {
						await increment(message.user, 'anime-song-answer-first-hint');
					}
					if (this.state.hints.length <= 2) {
						await unlock(message.user, 'anime-song-answer-second-hint');
					}
					if (this.state.hints.length <= 3) {
						await unlock(message.user, 'anime-song-answer-third-hint');
					}
					if (this.state.difficulty === 'hard') {
						await unlock(message.user, 'anime-song-hard-answer');
					}
					if (animeInfo && animeInfo.year !== null && animeInfo.year < 2010) {
						await unlock(message.user, 'anime-song-before-2010');
					}

					await this.deleteProgressMessage(this.state.thread!);

					this.state.answer = null;
					this.state.previousHint = 0;
					this.state.hints = [];
					this.state.thread = null;
					this.state.difficulty = null;
					this.state.channel = null;
				} else {
					await this.slack.reactions.add({
						name: 'no_good',
						channel: message.channel,
						timestamp: message.ts,
					});
				}
			});
		}
	}
}

export default function animeSongQuiz(slackClients: SlackInterface) {
	return new AnimeSongQuizBot(slackClients);
}
