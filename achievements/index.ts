import fs from 'fs';
import {promisify} from 'util';
import path from 'path';
import qs from 'querystring';
import {WebClient, RTMClient, MessageAttachment} from '@slack/client';
import axios from 'axios';
import {throttle, groupBy, get as getter, chunk} from 'lodash';
import moment from 'moment';
// @ts-ignore
import {stripIndent} from 'common-tags';
import Queue from 'p-queue';
import achievements, {Difficulty} from './achievements';
import {Deferred, getMemberName} from '../lib/utils';
import db from '../lib/firestore';

interface SlackInterface {
	rtmClient: RTMClient,
	webClient: WebClient,
	messageClient: any,
}

type Counter = Map<string, number>;
type Variable = Map<string, any>;

interface State {
	counters: {
		chats: Counter,
		chatDays: Counter,
		[name: string]: Counter,
	},
	variables: {
		lastChatDay: Variable,
		[name: string]: Variable,
	},
	achievements: Map<string, Set<string>>
}

const state: State = {
	counters: {
		chats: new Map(),
		chatDays: new Map(),
	},
	variables: {
		lastChatDay: new Map(),
	},
	achievements: new Map(),
};

const mapToObject = (map: Map<any, any>) => (
	Object.assign({}, ...[...map.entries()].map(([key, value]) => ({[key]: value})))
);

const difficultyToStars = (difficulty: Difficulty) => (
	{
		baby: '★☆☆☆☆',
		easy: '★★☆☆☆',
		medium: '★★★☆☆',
		hard: '★★★★☆',
		professional: '★★★★★',
	}[difficulty]
);

const difficultyToColor = (difficulty: Difficulty) => (
	{
		baby: '#03A9F4',
		easy: '#2E7D32',
		medium: '#F57C00',
		hard: '#D50000',
		professional: '#D500F9',
	}[difficulty]
);

const queue = new Queue({concurrency: 1});

const loadDeferred = new Deferred();

const initializeDeferred = new Deferred();

const saveState = async () => {
	await initializeDeferred.promise;

	queue.add(async () => {
		await promisify(fs.writeFile)(path.resolve(__dirname, 'state.json'), JSON.stringify({
			counters: {
				chats: mapToObject(state.counters.chats),
				chatDays: mapToObject(state.counters.chatDays),
			},
			variables: {
				lastChatDay: mapToObject(state.variables.lastChatDay),
			},
		}));
	});
};

const updateGist = throttle(async () => {
	const memberTexts = await Promise.all(Array.from(state.achievements.entries()).map(async ([user, achievementEntries]) => {
		if (achievementEntries.size === 0) {
			return '';
		}
		const difficultyGroups = groupBy(Array.from(achievementEntries), (id) => achievements.get(id).difficulty);
		const difficultyTexts = Object.entries(difficultyGroups).map(([difficulty, achievementGroup]: [Difficulty, string[]]) => {
			const achievementTexts = achievementGroup.map((id) => {
				const achievement = achievements.get(id);
				return stripIndent`
					* **${achievement.title}**
						* ${achievement.condition}
				`;
			});
			return [
				`### 難易度${difficultyToStars(difficulty)} (${difficulty})`,
				...achievementTexts,
			].join('\n');
		});
		return [
			`## @${await getMemberName(user)}`,
			...difficultyTexts,
		].join('\n');
	}));
	const markdown = [
		'# TSG実績一覧',
		...memberTexts.filter((text) => text !== ''),
	].join('\n');

	await axios.patch('https://api.github.com/gists/d5f284cf3a3433d01df081e8019176a1', {
		description: 'TSG実績一覧',
		files: {
			'achievements.md': {
				content: markdown,
			},
		},
	}, {
		headers: {
			Authorization: `token ${process.env.GITHUB_TOKEN}`,
		},
	});
}, 30 * 1000);

export default async ({rtmClient: rtm, webClient: slack, messageClient: slackInteractions}: SlackInterface) => {
	loadDeferred.resolve(slack);

	const {members}: any = await slack.users.list();
	for (const member of members) {
		for (const counter of Object.values(state.counters)) {
			counter.set(member.id, 0);
		}
		for (const variable of Object.values(state.variables)) {
			variable.set(member.id, 0);
		}
	}

	const stateData: Buffer = await promisify(fs.readFile)(path.resolve(__dirname, 'state.json')).catch(() => null);
	if (stateData !== null) {
		const data: State = JSON.parse(stateData.toString());

		for (const [counterName, counter] of Object.entries(data.counters)) {
			for (const [user, value] of Object.entries(counter)) {
				state.counters[counterName].set(user, value);
			}
		}

		for (const [variableName, variable] of Object.entries(data.variables)) {
			for (const [user, value] of Object.entries(variable)) {
				state.variables[variableName].set(user, value);
			}
		}
	}

	rtm.on('message', async (message) => {
		if (message.text && message.user && !message.bot_id && !message.subtype && message.channel.startsWith('C')) {
			const day = moment(parseFloat(message.ts) * 1000).utcOffset(9).format('YYYY-MM-DD');
			increment(message.user, 'chats');
			if (get(message.user, 'lastChatDay') !== day) {
				increment(message.user, 'chatDays');
				set(message.user, 'lastChatDay', day);
			}
		}

		if (message.channel.startsWith('D') && message.text === '実績解除') {
			const manualAchievements = Array.from(achievements.values()).filter((achievement) => (
				achievement.manual === true &&
				state.achievements.has(message.user) &&
				Array.from(state.achievements.get(message.user)).every((id) => id !== achievement.id)
			));
			const button: 'button' = 'button';
			await slack.chat.postMessage({
				channel: message.channel,
				text: '未解除の実績一覧',
				attachments: manualAchievements.map((achievement) => ({
					text: achievement.condition,
					fallback: achievement.condition,
					color: 'good',
				})),
			})
			await slack.chat.postMessage({
				channel: message.channel,
				text: '',
				attachments: chunk(manualAchievements, 5).map((achievementChunk, index) => ({
					text: index === 0 ? '解除した実績を選んでね！' : '',
					fallback: index === 0 ? '解除した実績を選んでね！' : '',
					callback_id: 'achievements',
					actions: achievementChunk.map((achievement) => ({
						name: 'unlock',
						text: achievement.condition,
						type: button,
						value: achievement.id,
					})),
				})),
			});
		}
	});

	rtm.on('reaction_added', async (event) => {
		if (event.user && event.item && event.item.channel.startsWith('C') && event.item_user && state.achievements.has(event.item_user)) {
			const reactionAchievements = Array.from(achievements.values()).filter((achievement) => (
				achievement.reaction === event.reaction
			));
			if (reactionAchievements.length === 0) {
				return;
			}
			const {data}: any = await axios.get(`https://slack.com/api/conversations.history?${qs.stringify({
				channel: event.item.channel,
				latest: event.item.ts,
				limit: 1,
				inclusive: true,
			})}`, {
				headers: {
					Authorization: `Bearer ${process.env.HAKATASHI_TOKEN}`,
				},
			});
			const reactions = getter(data, ['messages', 0, 'reactions'], []);
			const targetReaction = reactions.find(({name}: any) => name === event.reaction);
			if (!targetReaction) {
				return;
			}
			for (const achievement of reactionAchievements) {
				if (achievement.value <= targetReaction.count) {
					await unlock(event.item_user, achievement.id);
				}
			}
		}
	});

	rtm.on('team_join', (event) => {
		state.achievements.set(event.user.id, new Set());
		for (const counter of Object.values(state.counters)) {
			counter.set(event.user.id, 0);
		}
		for (const variable of Object.values(state.variables)) {
			variable.set(event.user.id, 0);
		}
		saveState();
	});

	slackInteractions.action({type: 'button', callbackId: 'achievements'}, (payload: any, respond: any) => {
		unlock(payload.user.id, payload.actions[0].value);
		respond({text: 'おめでとう!:tada:'});
	});

	const achievementsData = await db.collection('achievements').get();
	if (!achievementsData.empty) {
		for (const doc of achievementsData.docs) {
			const {id, user} = doc.data();
			if (!state.achievements.has(user)) {
				state.achievements.set(user, new Set());
			}
			state.achievements.get(user).add(id);
		}
	}

	initializeDeferred.resolve();
};

export const unlock = async (user: string, name: string) => {
	await initializeDeferred.promise;

	const achievement = achievements.get(name);
	if (!achievement) {
		throw new Error(`Unknown achievement name ${name}`);
	}

	if (!user || !user.startsWith('U') || user === 'USLACKBOT') {
		return;
	}

	if (!state.achievements.has(user)) {
		state.achievements.set(user, new Set())
	}

	if (state.achievements.get(user).has(name)) {
		return;
	}

	const existingAchievements = await db.collection('achievements').where('id', '==', name).get();
	const isFirst = existingAchievements.empty;

	const slack: WebClient = await loadDeferred.promise;

	state.achievements.get(user).add(name);

	await db.collection('achievements').add({
		user,
		id: name,
		date: new Date(),
	});

	const memberName = await getMemberName(user);
	const holdingAchievements = Array.from(state.achievements.get(user));
	const gistUrl = `https://gist.github.com/hakatashi/d5f284cf3a3433d01df081e8019176a1#${encodeURIComponent(memberName.toLowerCase())}`;
	slack.chat.postMessage({
		channel: process.env.CHANNEL_SANDBOX,
		username: 'achievements',
		icon_emoji: ':unlock:',
		text: stripIndent`
			<@${user}>が実績【${achievement.title}】を解除しました:tada::tada::tada: <${gistUrl}|[実績一覧]>
			_${achievement.condition}_
			難易度${difficultyToStars(achievement.difficulty)} (${achievement.difficulty}) ${isFirst ? '*初達成者!!:ojigineko-superfast:*' : ''}
		`,
		attachments: ['professional', 'hard', 'medium', 'easy', 'baby'].map((difficulty: Difficulty) => {
			const entries = holdingAchievements.filter((id) => achievements.get(id).difficulty === difficulty);
			if (entries.length === 0) {
				return null;
			}
			const attachment: MessageAttachment = {
				color: difficultyToColor(difficulty),
				text: entries.map((id) => achievements.get(id).title).join(' '),
			};
			return attachment;
		}),
	});

	await updateGist();

	const newAchievements = [];
	if (holdingAchievements.length >= 1) {
		newAchievements.push('achievements');
	}
	if (holdingAchievements.filter((id) => achievements.get(id).difficulty !== 'baby').length >= 3) {
		newAchievements.push('achievements-3');
	}
	if (holdingAchievements.filter((id) => achievements.get(id).difficulty !== 'baby').length >= 10) {
		newAchievements.push('achievements-10');
	}
	if (holdingAchievements.filter((id) => (
		achievements.get(id).difficulty !== 'baby'
		&& achievements.get(id).difficulty !== 'easy'
	)).length >= 10) {
		newAchievements.push('achievements-master');
	}

	for (const newAchievement of newAchievements) {
		await unlock(user, newAchievement);
	}
};

export const increment = async (user: string, name: string, value: number = 1) => {
	await initializeDeferred.promise;

	if (!state.counters[name]) {
		throw new Error(`Unknown counter name ${name}`);
	}

	if (!user || !user.startsWith('U') || user === 'USLACKBOT') {
		return;
	}

	const newValue = state.counters[name].get(user) + value;
	state.counters[name].set(user, newValue);
	saveState();

	const unlocked = Array.from(achievements.values()).find((achievement) => achievement.counter === name && achievement.value === newValue);
	if (unlocked !== undefined) {
		unlock(user, unlocked.id);
	}
};

export const get = (user: string, name: string) => {
	if (!state.variables[name]) {
		throw new Error(`Unknown variable name ${name}`);
	}

	if (!user || !user.startsWith('U') || user === 'USLACKBOT') {
		return;
	}

	return state.variables[name].get(user);
};

export const set = async (user: string, name: string, value: any) => {
	await initializeDeferred.promise;

	if (!state.variables[name]) {
		throw new Error(`Unknown variable name ${name}`);
	}

	if (!user || !user.startsWith('U') || user === 'USLACKBOT') {
		return;
	}

	state.variables[name].set(user, value);
	saveState();
};
