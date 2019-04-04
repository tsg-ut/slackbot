import {WebClient, RTMClient} from '@slack/client';
import axios from 'axios';
import {get as getter, throttle, groupBy} from 'lodash';
import moment from 'moment';
// @ts-ignore
import {stripIndent} from 'common-tags';
import achievements, {Difficulty} from './achievements';
import {Deferred, getMemberName} from '../lib/utils';

interface SlackInterface {
	rtmClient: RTMClient,
	webClient: WebClient,
}

type Counter = Map<string, number>;
type Variable = Map<string, any>;
interface Achievement {
	id: string,
	date: number,
}

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
	achievements: Map<string, Achievement[]>
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

let stateChanged = false;

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

const loadDeferred = new Deferred();

const updateGist = throttle(async () => {
	if (!stateChanged) {
		return;
	}

	stateChanged = false;

	const memberTexts = await Promise.all(Array.from(state.achievements.entries()).map(async ([user, achievementEntries]) => {
		if (achievementEntries.length === 0) {
			return '';
		}
		const difficultyGroups = groupBy(achievementEntries, ({id}) => achievements.get(id).difficulty);
		const difficultyTexts = Object.entries(difficultyGroups).map(([difficulty, achievementGroup]: [Difficulty, Achievement[]]) => {
			const achievementTexts = achievementGroup.map(({id, date}) => {
				const achievement = achievements.get(id);
				return stripIndent`
					* **${achievement.title}** (${moment(date).utcOffset(9).format('YYYY年MM月DD日')})
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
			'achievements-0-overview.md': {
				content: markdown,
			},
			'achievements-1-data.json': {
				content: JSON.stringify({
					counters: {
						chats: mapToObject(state.counters.chats),
						chatDays: mapToObject(state.counters.chatDays),
					},
					variables: {
						lastChatDay: mapToObject(state.variables.lastChatDay),
					},
					achievements: mapToObject(state.achievements),
				}),
			},
		},
	}, {
		headers: {
			Authorization: `token ${process.env.GITHUB_TOKEN}`,
		},
	});
}, 30 * 1000);

export default async ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
	loadDeferred.resolve(slack);

	const {members}: any = await slack.users.list();
	for (const member of members) {
		state.achievements.set(member.id, []);
		for (const counter of Object.values(state.counters)) {
			counter.set(member.id, 0);
		}
		for (const variable of Object.values(state.variables)) {
			variable.set(member.id, 0);
		}
	}

	const gistData = await axios.get('https://api.github.com/gists/d5f284cf3a3433d01df081e8019176a1');
	const json = getter(gistData, ['data', 'files', 'achievements-1-data.json', 'content']);
	const data: State = JSON.parse(json);

	for (const [user, achievements] of Object.entries(data.achievements)) {
		state.achievements.set(user, achievements);
	}

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

	setInterval(updateGist, 10 * 60 * 1000);

	rtm.on('message', async (message) => {
		if (message.text && message.user && !message.bot_id && message.channel.startsWith('C')) {
			const day = moment(parseFloat(message.ts) * 1000).utcOffset(9).format('YYYY-MM-DD');
			increment(message.user, 'chats');
			if (get(message.user, 'lastChatDay') !== day) {
				increment(message.user, 'chatDays');
				set(message.user, 'lastChatDay', day);
			}
		}
	});
};

export const unlock = async (user: string, name: string) => {
	const achievement = achievements.get(name);
	if (!achievement) {
		throw new Error(`Unknown achievement name ${name}`);
	}

	if (!user || !user.startsWith('U') || user === 'USLACKBOT') {
		return;
	}

	if (state.achievements.get(user).some(({id}) => id === name)) {
		return;
	}

	stateChanged = true;
	state.achievements.get(user).push({
		id: name,
		date: Date.now(),
	});

	if (achievement.difficulty !== 'baby') {
		const slack: WebClient = await loadDeferred.promise;
		slack.chat.postMessage({
			channel: process.env.CHANNEL_SANDBOX,
			username: 'achievements',
			icon_emoji: ':unlock:',
			text: stripIndent`
				<@${user}>が実績【${achievement.title}】を解除しました:tada::tada::tada:
				_${achievement.condition}_
				難易度${difficultyToStars(achievement.difficulty)} (${achievement.difficulty})
			`,
		});
	}

	await updateGist();
};

export const increment = (user: string, name: string, value: number = 1) => {
	if (!state.counters[name]) {
		throw new Error(`Unknown counter name ${name}`);
	}

	if (!user || !user.startsWith('U') || user === 'USLACKBOT') {
		return;
	}

	stateChanged = true;

	const newValue = state.counters[name].get(user) + value;
	state.counters[name].set(user, newValue);

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

	stateChanged = true;
	return state.variables[name].get(user);
};

export const set = (user: string, name: string, value: any) => {
	if (!state.variables[name]) {
		throw new Error(`Unknown variable name ${name}`);
	}

	if (!user || !user.startsWith('U') || user === 'USLACKBOT') {
		return;
	}

	stateChanged = true;
	return state.variables[name].set(user, value);
};
