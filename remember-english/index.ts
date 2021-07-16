/* eslint-disable import/default */
/* eslint-disable import/no-named-as-default-member */
import type {KnownBlock, ImageBlock, WebClient, ViewsOpenArguments} from '@slack/web-api';
import {Mutex} from 'async-mutex';
import type {Model} from 'ebisu-js';
import ebisu from 'ebisu-js';
import {sortBy, get, clamp} from 'lodash';
import schedule from 'node-schedule';
import type {SlackInterface} from '../lib/slack';
import {getMemberIcon, getMemberName, mrkdwn, plainText} from '../lib/slackUtils';
import State from '../lib/state';

interface Word {
	ja: string,
	en: string,
	createdAt: number,
}

type ChallengeWord = {
	en: string;
	forgettingRate: number,
	success: number;
};

interface Challenge {
	id: string,
	words: ChallengeWord[],
	createdAt: number,
	finished: boolean,
	participants: string[],
	ts: string,
}

interface StateObj {
	words: Word[],
	challenges: Challenge[],
}

const mutex = new Mutex();

class Dictionary {
	models: Map<string, Model>;

	words: Map<string, Word>;

	static t = 7 * 24 * 60 * 60 * 1000;

	constructor(words: Word[]) {
		this.models = new Map(words.map((word) => (
			[word.en, ebisu.defaultModel(Dictionary.t)]
		)));
		this.words = new Map(words.map((word) => (
			[word.en, word]
		)));
	}

	addWord(word: Word) {
		this.models.set(word.en, ebisu.defaultModel(Dictionary.t));
		this.words.set(word.en, word);
	}

	setRecall({word, success, total, now}: {word: string, success: number, total: number, now: number}) {
		const model = this.models.get(word);
		const wordData = this.words.get(word);

		if (!model || !wordData) {
			throw new Error(`${word} is not in the dictionary`);
		}

		const newModel = ebisu.updateRecall(model, success, total, now - wordData.createdAt);
		this.models.set(word, newModel);
	}

	getForgottenWords(now: number): {en: string, forgettingRate: number}[] {
		const words = Array.from(this.words.keys());
		const wordAndRates: [string, number][] = words.map((word) => {
			const model = this.models.get(word);
			return [word, ebisu.predictRecall(model, now - this.words.get(word).createdAt, true)];
		});
		const sortedWords = sortBy(wordAndRates, ([, rate]) => rate);
		console.log(sortedWords);

		return sortedWords.slice(0, 3).map(([word, rate]) => ({en: word, forgettingRate: 1 - rate}));
	}
}

export class RememberEnglish {
	slack: WebClient;

	state: StateObj;

	previousTick: number;

	dictionary: Dictionary;

	constructor({slack}: {slack: WebClient}) {
		this.slack = slack;
		this.previousTick = 0;
	}

	async initialize() {
		this.state = await State.init<StateObj>('remember-english', {
			words: [],
			challenges: [],
		});

		this.dictionary = new Dictionary(this.state.words);
		for (const challenge of this.state.challenges) {
			if (!challenge.finished) {
				continue;
			}

			for (const word of challenge.words) {
				this.dictionary.setRecall({
					word: word.en,
					success: word.success,
					total: challenge.participants.length,
					now: challenge.createdAt,
				});
			}
		}

		schedule.scheduleJob('0 10 * * *', () => {
			mutex.runExclusive(() => (
				this.dailyJob()
			));
		});
	}

	private dailyJob() {
		let finished = false;
		for (const challenge of this.state.challenges) {
			if (!challenge.finished && challenge.participants.length >= 3) {
				this.finishChallenge(challenge);
				finished = true;
			}
		}

		const unfinishedChallenges = this.state.challenges.filter((challenge) => !challenge.finished);
		if (finished || unfinishedChallenges.length === 0) {
			this.postChallenge();
		}
	}

	private finishChallenge(challenge: Challenge) {
		let successes = 0;
		for (const word of challenge.words) {
			this.dictionary.setRecall({
				word: word.en,
				success: word.success,
				total: challenge.participants.length,
				now: challenge.createdAt,
			});
			successes += word.success;
		}

		challenge.finished = true;
		const totalScore = Math.floor(successes / challenge.participants.length * 100);

		return this.postMessage({
			text: '',
			blocks: [
				{
					type: 'header',
					text: plainText('Results'),
				},
				{
					type: 'section',
					text: mrkdwn(challenge.words.map((word) => (
						`●  *${word.en}*: ${this.state.words.find((w) => w.en === word.en).ja} (Score: ${word.success}/${challenge.participants.length})`
					)).join('\n')),
				},
				{
					type: 'section',
					text:
					mrkdwn(`Total Score: *${totalScore}* / 300\nGood Job! 😁`)
					,
				},
			],
		});
	}

	async postChallenge() {
		const now = Date.now();
		const id = now.toString();

		const forgottenWords = this.dictionary.getForgottenWords(now);
		const challenge: Challenge = {
			id,
			createdAt: now,
			words: forgottenWords.map((word) => ({
				en: word.en,
				forgettingRate: word.forgettingRate,
				success: 0,
			})),
			finished: false,
			participants: [],
			ts: null,
		};

		const message = await this.postMessage({
			text: '',
			blocks: await this.getChallengeBlocks(challenge),
		});

		challenge.ts = message.ts as string;
		this.state.challenges.push(challenge);
	}

	private async getChallengeBlocks(challenge: Challenge): Promise<KnownBlock[]> {
		const userIcons = await Promise.all(challenge.participants.map((participant) => getMemberIcon(participant)));

		return [
			{
				type: 'header',
				text: plainText('Do you remember the meaning?'),
			},
			{
				type: 'section',
				text: mrkdwn(challenge.words.map((word) => (
					`●  *${word.en}* (forget rate: ${(word.forgettingRate * 100).toFixed(1)}%)`
				)).join('\n')),
			},
			{
				type: 'actions',
				block_id: 'remember_english_post_challenge_actions',
				elements: [
					{
						type: 'button',
						text: plainText('Reveal the answers'),
						action_id: 'reveal',
						value: challenge.id,
						style: 'primary',
					},
					{
						type: 'button',
						text: plainText('Post “Today\'s English”'),
						action_id: 'add_word',
						value: challenge.id,
					},
				],
			},
			{
				type: 'context',
				elements: [
					plainText('participants (3 ppl needed to continue):'),
					...(userIcons.map((icon) => ({
						type: 'image',
						image_url: icon,
						alt_text: 'user',
					} as ImageBlock))),
				],
			},
		];
	}

	showRevealDialog({triggerId, id, user, respond}: {triggerId: string, id: string, user: string, respond: any}) {
		const challenge = this.state.challenges.find((g) => g.id === id);
		if (!challenge) {
			respond({
				text: 'Error: Challenge not found',
				response_type: 'ephemeral',
				replace_original: false,
			});
			return null;
		}

		if (challenge.finished) {
			respond({
				text: 'Error: Challenge is finished',
				response_type: 'ephemeral',
				replace_original: false,
			});
			return null;
		}

		if (challenge.participants.some((participant) => participant === user)) {
			respond({
				text: 'You already answered this challenge',
				response_type: 'ephemeral',
				replace_original: false,
			});
			return null;
		}

		const words = challenge.words.map(({en}) => this.state.words.find((w) => w.en === en));

		return this.viewsOpen({
			trigger_id: triggerId,
			view: {
				callback_id: 'remember_english_answer',
				private_metadata: challenge.id,
				type: 'modal' as 'modal',
				title: plainText('Answers'),
				submit: plainText('Record Result'),
				blocks: [
					...(words.map((word, i) => ({
						type: 'input',
						block_id: `remember_english_answer-${i}`,
						label: plainText(`${word.en}: ${word.ja}`),
						element: {
							type: 'radio_buttons' as ('radio_buttons'),
							action_id: 'action',
							options: [
								{
									text: plainText(':o: I remembered it'),
									value: 'correct',
								},
								{
									text: plainText(':x: I forgot it'),
									value: 'incorrect',
								},
							],
						},
					}))),
				],
			},
		});
	}

	showAddWordDialog({triggerId}: {triggerId: string}) {
		return this.viewsOpen({
			trigger_id: triggerId,
			view: {
				callback_id: 'remember_english_add_word',
				type: 'modal' as 'modal',
				title: plainText('Add Today\'s English'),
				submit: plainText('Add word'),
				blocks: [
					{
						type: 'input',
						block_id: 'remember_english_add_word-en',
						label: plainText('English'),
						element: {
							type: 'plain_text_input' as 'plain_text_input',
							action_id: 'action',
							placeholder: plainText('programming'),
						},
					},
					{
						type: 'input',
						block_id: 'remember_english_add_word-ja',
						label: plainText('Japanese'),
						element: {
							type: 'plain_text_input' as 'plain_text_input',
							action_id: 'action',
							placeholder: plainText('プログラミング'),
						},
					},
				],
			},
		});
	}

	async recordResult({id, user, results}: {id: string, user: string, results: boolean[]}) {
		const challenge = this.state.challenges.find((g) => g.id === id);
		if (!challenge || challenge.finished) {
			return;
		}
		if (challenge.participants.some((participant) => participant === user)) {
			return;
		}

		for (const [i, result] of results.entries()) {
			if (result) {
				challenge.words[i].success += 1;
			}
		}

		challenge.participants.push(user);

		await this.updateMessage({
			text: '',
			ts: challenge.ts,
			blocks: await this.getChallengeBlocks(challenge),
		});
	}

	async addWord({en, ja, user}: {en: string, ja: string, user: string}) {
		const now = Date.now();
		const username = await getMemberName(user);
		const icon = await getMemberIcon(user, 192);

		if (this.state.words.some((w) => w.en === en)) {
			return;
		}

		const word: Word = {en, ja, createdAt: now};

		this.state.words.push(word);
		this.dictionary.addWord(word);

		await this.postMessage({
			username,
			icon_url: icon,
			text: `Today's English: ${en} (${ja})`,
		});
	}

	// eslint-disable-next-line camelcase
	postMessage(message: {text: string, blocks?: KnownBlock[], username?: string, icon_url?: string}) {
		return this.slack.chat.postMessage({
			channel: process.env.CHANNEL_SIG_ENGLISH,
			username: 'rememberbot',
			...(message.icon_url ? {} : {icon_emoji: ':abcd:'}),
			...message,
		});
	}

	updateMessage(message: {text: string, ts: string, blocks?: KnownBlock[]}) {
		return this.slack.chat.update({
			channel: process.env.CHANNEL_SIG_ENGLISH,
			...message,
		});
	}

	viewsOpen(data: ViewsOpenArguments) {
		return this.slack.views.open(data);
	}
}

export default async ({webClient: slack, messageClient: slackInteractions}: SlackInterface) => {
	const rememberEnglish = new RememberEnglish({slack});
	await rememberEnglish.initialize();

	slackInteractions.action({
		blockId: 'remember_english_post_challenge_actions',
		actionId: 'reveal',
	}, (payload: any, respond: any) => {
		const [action] = payload.actions;
		mutex.runExclusive(() => (
			rememberEnglish.showRevealDialog({
				triggerId: payload.trigger_id,
				user: payload.user.id,
				id: action.value,
				respond,
			})
		));
	});

	slackInteractions.action({
		blockId: 'remember_english_post_challenge_actions',
		actionId: 'add_word',
	}, (payload: any) => {
		mutex.runExclusive(() => (
			rememberEnglish.showAddWordDialog({
				triggerId: payload.trigger_id,
			})
		));
	});

	slackInteractions.viewSubmission({
		callbackId: 'remember_english_answer',
	}, (payload: any) => {
		const values = get(payload, ['view', 'state', 'values'], {});
		const results = Array(Object.keys(values).length).fill(false);

		for (const [blockId, value] of Object.entries(values)) {
			const [, idStr] = blockId.split('-');
			const id = clamp(parseInt(idStr) || 0, 0, results.length - 1);
			const optionValue = get(value, ['action', 'selected_option', 'value'], 'incorrect');
			results[id] = optionValue === 'correct';
		}

		mutex.runExclusive(() => (
			rememberEnglish.recordResult({
				id: payload.view.private_metadata,
				user: payload.user.id,
				results,
			})
		));

		return {
			response_action: 'clear',
		};
	});

	slackInteractions.viewSubmission({
		callbackId: 'remember_english_add_word',
	}, (payload: any) => {
		const en = get(payload, ['view', 'state', 'values', 'remember_english_add_word-en', 'action', 'value'], '');
		const ja = get(payload, ['view', 'state', 'values', 'remember_english_add_word-ja', 'action', 'value'], '');

		if (en === '' || ja === '') {
			return {};
		}

		mutex.runExclusive(() => (
			rememberEnglish.addWord({
				user: payload.user.id,
				en,
				ja,
			})
		));

		return {
			response_action: 'clear',
		};
	});
};
