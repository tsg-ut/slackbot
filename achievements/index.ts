import {WebClient, RTMClient} from '@slack/client';
import axios from 'axios';
import {get} from 'lodash';
import achievements from './achievements';

interface SlackInterface {
	rtmClient: RTMClient,
	webClient: WebClient,
}

type Counter = Map<string, number>;
type Variable = Map<string, any>;
interface Achievement {
	name: string,
	date: Date,
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

export default async ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
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
	const json = get(gistData, ['data', 'files', 'achievements-1-data.json', 'content']);
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

	setInterval(async () => {
		if (!stateChanged) {
			return;
		}

		stateChanged = false;

		await axios.patch('https://api.github.com/gists/d5f284cf3a3433d01df081e8019176a1', {
			description: 'TSG実績一覧',
			files: {
				'achievements-0-overview.md': {
					content: '# temp',
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
	}, 60 * 1000);

	rtm.on('message', async (message) => {
	});
};
