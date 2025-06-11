// eslint-disable-next-line no-unused-vars
import {WebClient} from '@slack/web-api';
import {Mutex} from 'async-mutex';
import {stripIndent} from 'common-tags';
import {countBy, throttle, groupBy, get as getter, chunk} from 'lodash';
import moment from 'moment';
import db from '../lib/firestore';
// eslint-disable-next-line no-unused-vars
import logger from '../lib/logger';
import type {SlackInterface} from '../lib/slack';
import {getReactions} from '../lib/slackUtils';
import {updateUsageCount} from '../lib/state';
import {Deferred} from '../lib/utils';
import achievements, {Difficulty} from './achievements';

const mutex = new Mutex();

const log = logger.child({bot: 'achievements'});

type users = {
	chats?: number,
	chatDays?: number,
	lastChatDay?: string,
	tashibotDistance?: number,
	tahoiyaWin?: number,
	tahoiyaDeceive?: number,
	tahoiyaParitcipate?: number,
	shogiWin?: number,
	[key: string]: any,
};

interface State {
	users: Map<string, users>,
	achievements: Map<string, Set<string>>
}

const state: State = {
	users: new Map(),
	achievements: new Map(),
};

const difficultyToStars = (difficulty: Difficulty) => (
	{
		baby: '★☆☆☆☆',
		easy: '★★☆☆☆',
		medium: '★★★☆☆',
		hard: '★★★★☆',
		professional: '★★★★★',
	}[difficulty]
);

const loadDeferred = new Deferred<WebClient>();
const initializeDeferred = new Deferred<void>();

export default async ({eventClient, webClient: slack, messageClient: slackInteractions}: SlackInterface) => {
	loadDeferred.resolve(slack);

	eventClient.on('message', async (message) => {
		if (message.text && message.user && !message.bot_id && !message.subtype && message.channel.startsWith('C')) {
			const day = moment(parseFloat(message.ts) * 1000).utcOffset(9).format('YYYY-MM-DD');
			increment(message.user, 'chats');
			const lastChatDay = await get(message.user, 'lastChatDay');
			if (lastChatDay !== day) {
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
			});
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

	eventClient.on('reaction_added', async (event) => {
		if (event.user && event.item && event.item.channel.startsWith('C') && event.item_user) {
			const reactionAchievements = Array.from(achievements.values()).filter((achievement) => (
				achievement.reaction === event.reaction
			));
			const reactions = await getReactions(event.item.channel, event.item.ts);
			const reactedUsers = reactions[event.reaction] || [];
			const messageURL = event.item.type === 'message'
				? `<https://tsg-ut.slack.com/archives/${event.item.channel}/p${event.item.ts.replace('.', '')}|[メッセージ]>`
				: '';

			for (const achievement of reactionAchievements) {
				if (achievement.value <= reactedUsers.length) {
					await unlock(event.item_user, achievement.id, messageURL);
				}
			}

			if (reactedUsers.length >= 1) {
				const firstReactedUser = reactedUsers[0];

				for (const threshold of [5, 10, 15, 20, 25, 30]) {
					if (reactedUsers.length >= threshold) {
						const messagesKey = `reaction-${event.reaction}-${threshold}-first-reaction-messages`;
						const achievementName = `reaction-${event.reaction}-${threshold}-first-reaction`;

						mutex.runExclusive(async () => {
							const reactionMessages = (await get(firstReactedUser, messagesKey)) || [];
							if (!reactionMessages.includes(event.item.ts)) {
								await set(firstReactedUser, messagesKey, [...reactionMessages, event.item.ts]);
								await increment(firstReactedUser, achievementName, 1, messageURL);
								await increment(firstReactedUser, `reaction-${threshold}-reactions-first-reaction`, 1, messageURL);
							}
						});
					}
				}
			}
		}
	});

	slackInteractions.action({type: 'button', callbackId: 'achievements'}, (payload: any, respond: any) => {
		unlock(payload.user.id, payload.actions[0].value);
		respond({text: 'おめでとう!:tada:'});
	});

	const achievementsData = await db.collection('achievements').get();
	if (!achievementsData.empty) {
		for (const doc of achievementsData.docs) {
			const {name, user} = doc.data();
			if (!state.achievements.has(user)) {
				state.achievements.set(user, new Set());
			}
			state.achievements.get(user).add(name);
		}
	}

	const usersData = await db.collection('users').get();
	const usersSet = new Set();
	if (!usersData.empty) {
		for (const doc of usersData.docs) {
			const data = doc.data();
			state.users.set(doc.id, data || Object.create(null));
			usersSet.add(doc.id);
		}
	}

	// Temporal migration: Remove all achievements data with category = 'ricochet-robots' and created after 2024-07-25 and before 2024-08-08
	const ricochetRobotsAchievements = await db.collection('achievement_data').where('category', '==', 'ricochet-robots').get();
	for (const doc of ricochetRobotsAchievements.docs) {
		const data = doc.data();
		const ricochetRobotsAchievementsData = await db.collection('achievements').where('name', '==', data.id).get();
		for (const doc2 of ricochetRobotsAchievementsData.docs) {
			const achievementData = doc2.data();
			if (
				achievementData.date.toDate() > new Date('2024-07-25T00:00:00Z') &&
				achievementData.date.toDate() < new Date('2024-08-09T00:00:00Z')
			) {
				await doc2.ref.delete();
				log.debug(`${achievementData.user}の実績「${data.title}」を削除しました`);
			}
		}
	}

	initializeDeferred.resolve();

	const achievementsDataData = await db.collection('achievement_data').get();
	const achievementsDataSet = new Set(achievementsDataData.docs.map((a) => a.id));
	for (const achievementChunks of chunk(Array.from(achievements), 300) as any) {
		const batch = db.batch();
		for (const [id, achievement] of achievementChunks) {
			if (achievementsDataSet.has(id)) {
				batch.update(db.collection('achievement_data').doc(id), achievement);
			} else {
				batch.set(db.collection('achievement_data').doc(id), achievement);
			}
		}
		await batch.commit();
	}
};

interface IncrementOperation {
	type: 'increment',
	name: string,
	value: number,
	user: string,
}

interface SetOperation {
	type: 'set',
	name: string,
	value: any,
	user: string,
}

type Operation = IncrementOperation | SetOperation;

const pendingOperations: Operation[] = [];

const updateDb = (operation: Operation) => {
	pendingOperations.push(operation);
	triggerUpdateDb();
};

// TODO: Sync back changes to local state
const triggerUpdateDb = throttle(async () => {
	const operations = pendingOperations.splice(0);
	const users = groupBy(operations, (operation) => operation.user);
	await db.runTransaction(async (transaction) => {
		const userData = new Map();
		// read before write
		await Promise.all(Object.keys(users).map(async (user) => {
			const userRef = db.collection('users').doc(user);
			const userTransaction = await transaction.get(userRef);
			updateUsageCount(`achievements_${user}_get`);
			const data = userTransaction.data() || {};
			userData.set(user, {data, exists: userTransaction.exists});
		}));
		for (const [user, userOperations] of Object.entries(users)) {
			const userRef = db.collection('users').doc(user);
			const {data, exists} = userData.get(user);
			for (const operation of userOperations) {
				if (operation.type === 'increment') {
					if ({}.hasOwnProperty.call(data, operation.name)) {
						data[operation.name] += operation.value;
					} else {
						data[operation.name] = operation.value;
					}
				}
				if (operation.type === 'set') {
					data[operation.name] = operation.value;
				}
			}
			if (exists) {
				transaction.update(userRef, data);
				updateUsageCount(`achievements_${user}_update`);
			} else {
				transaction.set(userRef, data);
				updateUsageCount(`achievements_${user}_set`);
			}
		}
	});
}, 30 * 1000);

const getAchievementsText = (holdingAchievements: string[], newDifficulty: Difficulty) => {
	const achievementCounts = countBy(holdingAchievements, (id) => achievements.get(id).difficulty);
	const hearts = ([
		['professional', ':purple_heart:'],
		['hard', ':heart:'],
		['medium', ':orange_heart:'],
		['easy', ':green_heart:'],
		['baby', ':blue_heart:'],
	] as [Difficulty, string][]).map(([difficulty, emoji]) => {
		const count = getter(achievementCounts, [difficulty], 0);
		if (difficulty === newDifficulty) {
			return `${emoji}*${count}*`;
		}
		return `${emoji}${count}`;
	});

	return [
		...hearts,
		`計 *${holdingAchievements.length}* 個`,
	].join(' ');
};

export const unlock = async (user: string, name: string, additionalInfo?: string) => {
	await initializeDeferred.promise;

	const achievement = achievements.get(name);
	if (!achievement) {
		throw new Error(`Unknown achievement name ${name}`);
	}

	if (!user || !user.startsWith('U') || user === 'USLACKBOT') {
		return;
	}

	if (!state.achievements.has(user)) {
		state.achievements.set(user, new Set());
	}

	if (state.achievements.get(user).has(name)) {
		return;
	}

	const existingAchievements = await db.collection('achievements').where('name', '==', name).get();
	const isFirst = existingAchievements.empty;

	const slack: WebClient = await loadDeferred.promise;

	state.achievements.get(user).add(name);

	await db.collection('achievements').add({
		user,
		name,
		date: new Date(),
	});

	const holdingAchievements = Array.from(state.achievements.get(user));
	const userUrl = `https://achievements.tsg.ne.jp/users/${user}`;
	const achievementUrl = `https://achievements.tsg.ne.jp/achievements/${achievement.id}`;

	slack.chat.postMessage({
		channel: process.env.CHANNEL_SANDBOX,
		username: 'achievements',
		icon_emoji: ':unlock:',
		text: stripIndent`
			<@${user}>が実績【<${achievementUrl}|${achievement.title}>】を解除しました:tada::tada::tada: <${userUrl}|[実績一覧]>
			_${achievement.condition}_
			難易度${difficultyToStars(achievement.difficulty)} (${achievement.difficulty}) ${isFirst ? '*初達成者!!:ojigineko-superfast:*' : ''}
			${additionalInfo === undefined ? '' : additionalInfo}`,
		attachments: [{
			text: getAchievementsText(holdingAchievements, achievement.difficulty),
		}],
	});

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
	if (holdingAchievements.filter((id) => achievements.get(id).difficulty !== 'baby').length >= 70) {
		newAchievements.push('achievements-70');
	}
	if (holdingAchievements.filter((id) => (
		achievements.get(id).difficulty !== 'baby' &&
		achievements.get(id).difficulty !== 'easy'
	)).length >= 10) {
		newAchievements.push('achievements-master');
	}

	for (const newAchievement of newAchievements) {
		await unlock(user, newAchievement);
	}
};

// migration purpose only. not modifying local state
export const lock = async (user: string, name: string) => {
	const achievement = achievements.get(name);
	if (!achievement) {
		throw new Error(`Unknown achievement name ${name}`);
	}

	if (!user || !user.startsWith('U') || user === 'USLACKBOT') {
		throw new Error(`Invalid user name ${user}`);
	}

	const existingAchievement = await db.collection('achievements').where('name', '==', name).where('user', '==', user).get();
	if (existingAchievement.empty) {
		log.error(`${user} is not unlocking ${name} on db`);
	} else {
		for (const doc of existingAchievement.docs) {
			await doc.ref.delete();
		}
	}

	log.debug(`@${user}の実績「${achievement.title}」を削除しました`);
};

export const isUnlocked = async (user: string, name: string) => {
	await initializeDeferred.promise;

	const achievement = achievements.get(name);
	if (!achievement) {
		throw new Error(`Unknown achievement name ${name}`);
	}

	if (!user || !user.startsWith('U') || user === 'USLACKBOT') {
		return false;
	}

	if (!state.achievements.has(user)) {
		state.achievements.set(user, new Set());
	}

	return state.achievements.get(user).has(name);
};

export const increment = async (user: string, name: string, value = 1, additionalInfo: string = undefined) => {
	await initializeDeferred.promise;

	if (!user || !user.startsWith('U') || user === 'USLACKBOT') {
		return;
	}

	if (!state.users.has(user)) {
		state.users.set(user, Object.create(null));
	}

	const newValue = (state.users.get(user)[name] || 0) + value;
	state.users.get(user)[name] = newValue;

	const unlocked = Array.from(achievements.values()).filter((achievement) => achievement.counter === name && achievement.value <= newValue);
	for (const achievement of unlocked) {
		unlock(user, achievement.id, additionalInfo);
	}

	updateDb({type: 'increment', name, value, user});
};

export const get = async (user: string, name: string) => {
	await initializeDeferred.promise;

	if (!user || !user.startsWith('U') || user === 'USLACKBOT') {
		return undefined;
	}

	if (!state.users.has(user)) {
		state.users.set(user, Object.create(null));
	}

	return state.users.get(user)[name];
};

export const set = async (user: string, name: string, value: any) => {
	await initializeDeferred.promise;

	if (!user || !user.startsWith('U') || user === 'USLACKBOT') {
		return;
	}

	if (!state.users.has(user)) {
		state.users.set(user, Object.create(null));
	}

	state.users.get(user)[name] = value;

	if (typeof value === 'number') {
		const unlocked = Array.from(achievements.values()).filter((achievement) => achievement.counter === name && achievement.value <= value);
		for (const achievement of unlocked) {
			unlock(user, achievement.id);
		}
	}

	updateDb({type: 'set', user, name, value});
};

