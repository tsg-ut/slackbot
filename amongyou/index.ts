import {constants, promises as fs} from 'fs';
import path from 'path';
import {RTMClient} from '@slack/rtm-api';
import {ChatPostMessageArguments, WebClient} from '@slack/web-api';
import {stripIndent} from 'common-tags';
// @ts-ignore
import type {FastifyPluginCallback} from 'fastify';
import plugin from 'fastify-plugin';
import {range} from 'lodash';
import type {SlackInterface, SlashCommandEndpoint} from '../lib/slack';
import {getMemberIcon, getMemberName} from '../lib/slackUtils';
import {Deferred} from '../lib/utils';

const CALLME = '@amongyou';
const AMONGABLE_CHECK_INTERVAL = 10 * 60 * 1000;

const timeList = range(0, 27).map((n) => {
	const h = n.toString().padStart(2, '0');
	return [`${h}:00`, `${h}:30`];
}).flat();

const numList = [
	'5', '8', '1',
];

export interface User{
	slackId: string,
	probability: number,
	timeStart: Date,
	timeEnd: Date,
	people: number,
}

interface State{
	users: User[],
	activeThread: string,
	activeChannel: string,
	tmpUsers: User[],
}

const printableDate = (date: Date) => {
	const jpDate = new Date(date.getTime());
	jpDate.setUTCHours(jpDate.getUTCHours() + 9);
	return `${jpDate.getUTCMonth() + 1}/${jpDate.getUTCDate()} ${(`00${String(jpDate.getUTCHours())}`).slice(-2)}:${(`00${String(jpDate.getUTCMinutes())}`).slice(-2)}`;
};

const parseDate = (strDate: string) => {
	const tmpDates = strDate.split(':');
	if (tmpDates.length !== 2) {
		return null;
	}
	const hour = Number(tmpDates[0]);
	const minute = Number(tmpDates[1]);
	if (isNaN(hour) || isNaN(minute)) {
		return null;
	}
	const date = new Date();
	date.setHours(hour);
	date.setMinutes(minute);
	return date;
};

const getAmongableMessage = (amongableUsers: User[]) => {
	let text = `*AmongUsが開催できるよ〜〜* (${amongableUsers.length}人) :among_us_report: :among_us_report:\n`;
	for (const user of amongableUsers) {
		text += `<@${user.slackId}> `;
	}
	return text;
};

const getModalBlocks = () => [
	{
		type: 'section',
		text: {
			type: 'mrkdwn',
			text: '*参加可能時刻* と *希望最低人数* を選んでね! :among_us_red:',
		},
	},
	{
		type: 'actions',
		elements: [
			{
				type: 'static_select',
				placeholder: {
					type: 'plain_text',
					text: '開始',
					emoji: true,
				},
				action_id: 'amongyou-start-time',
				options: getTimeOptions(),
			},
			{
				type: 'static_select',
				placeholder: {
					type: 'plain_text',
					text: '終了',
					emoji: true,
				},
				action_id: 'amongyou-end-time',
				options: getTimeOptions(),
			},
			{
				type: 'static_select',
				placeholder: {
					type: 'plain_text',
					text: '希望最低人数',
					emoji: true,
				},
				options: getNumOptions(),
				action_id: 'amongyou-num-people',
			},
		],
	},
];

const getBlocks = () => [
	{
		type: 'actions',
		elements: [
			{
				type: 'button',
				text: {
					type: 'plain_text',
					emoji: true,
					text: '参加取り消し',
				},
				style: 'danger',
				value: 'amongus-cancel',
				action_id: 'amongyou-cancel',
			},
			{
				type: 'button',
				text: {
					type: 'plain_text',
					emoji: true,
					text: 'JOIN!',
				},
				style: 'primary',
				value: 'amongus-join',
				action_id: 'amongyou-join',
			},
		],
	},
];

class Among {
	rtm: RTMClient;

	slack: WebClient;

	slackInteractions: any;

	state: State;

	loadDeferred: Deferred;

	// eslint-disable-next-line no-undef
	activeSchedular: NodeJS.Timeout;

	constructor({
		rtm,
		slack,
		slackInteractions,
	}: {
		rtm: RTMClient,
		slack: WebClient,
		slackInteractions: any,
	}) {
		this.rtm = rtm;
		this.slack = slack;
		this.slackInteractions = slackInteractions;
		this.loadDeferred = new Deferred();
		this.state = {
			users: [],
			tmpUsers: [],
			activeThread: null,
			activeChannel: null,
		};
	}

	async initialize() {
		if (this.loadDeferred.isResolved) {
			return this.loadDeferred.promise;
		}

		// restore state
		const statePath = path.resolve(__dirname, 'state.json');
		const exists = await fs.access(statePath, constants.F_OK)
			.then(() => true).catch(() => false);
		this.state = {
			users: [],
			tmpUsers: [],
			activeThread: null,
			activeChannel: null,
			...(exists ? JSON.parse((await fs.readFile(statePath)).toString()) : {}),
		};
		this.state.users = this.state.users.map((user) => ({
			...user,
			timeStart: new Date(user.timeStart),
			timeEnd: new Date(user.timeEnd),
		}));
		this.state.tmpUsers = this.state.tmpUsers.map((user) => ({
			...user,
			timeStart: new Date(user.timeStart),
			timeEnd: new Date(user.timeEnd),
		}));
		await fs.writeFile(statePath, JSON.stringify(this.state));
		if (this.state.activeThread !== null) {
			this.activeSchedular = setInterval(() => this.checkAmongable(), AMONGABLE_CHECK_INTERVAL);
		}

		// register actions
		this.slackInteractions.action({
			type: 'button',
			actionId: 'amongyou-join',
		// eslint-disable-next-line no-unused-vars
		}, (payload: any, respond: any) => {
			this.slack.views.open({
				trigger_id: payload.trigger_id,
				view: {
					type: 'modal',
					callback_id: 'amongyou-join-info',
					submit: {
						type: 'plain_text',
						text: 'JOIN!',
						emoji: true,
					},
					title: {
						type: 'plain_text',
						text: 'AmongYOU: 希望要件',
					},
					blocks: getModalBlocks(),
				},
			});
		});

		this.slackInteractions.viewSubmission('amongyou-join-info', async (payload: any) => {
			this.joinUser(payload.user.id);
			this.slack.chat.update({
				channel: this.state.activeChannel,
				ts: this.state.activeThread,
				text: '*現在の参加予定者だよ!*',
				attachments: await this.getStatAttachments(),
			});

			this.checkAmongable();
		});

		this.slackInteractions.action({
			type: 'button',
			actionId: 'amongyou-cancel',
		// eslint-disable-next-line no-unused-vars
		}, async (payload: any, respond: any) => {
			this.cancelUser(payload.user.id);
			this.slack.chat.update({
				channel: this.state.activeChannel,
				ts: this.state.activeThread,
				text: '*現在の参加予定者だよ!*',
				attachments: await this.getStatAttachments(),
			});
		});

		this.slackInteractions.action({
			type: 'static_select',
			actionId: 'amongyou-start-time',
		// eslint-disable-next-line no-unused-vars
		}, (payload: any, respond: any) => {
			this.setStartTime(payload.user.id, payload.actions[0].selected_option.text.text);
		});

		this.slackInteractions.action({
			type: 'static_select',
			actionId: 'amongyou-end-time',
		// eslint-disable-next-line no-unused-vars
		}, (payload: any, respond: any) => {
			this.setEndTime(payload.user.id, payload.actions[0].selected_option.text.text);
		});

		this.slackInteractions.action({
			type: 'static_select',
			actionId: 'amongyou-num-people',
		// eslint-disable-next-line no-unused-vars
		}, (payload: any, respond: any) => {
			this.setNumPeople(payload.user.id, payload.actions[0].selected_option.text.text);
		});

		// register RTM
		this.rtm.on('message', async (message) => {
			// eslint-disable-next-line max-len
			if (!message.text || message.subtype || (message.channel !== process.env.CHANNEL_SANDBOX && message.channel !== process.env.CHANNEL_AMONGUS) || !message.text.startsWith(CALLME)) {
				return;
			}
			const args = message.text.split(' ').slice(1);
			switch (args[0]) {
				default:
					await this.postMessageDefault(message, {
						text: ':wakarazu:',
					});
					break;
			}
		});

		this.loadDeferred.resolve();
		return this.loadDeferred.promise;
	}

	async clearFile() {
		const statePath = path.resolve(__dirname, 'state.json');
		await fs.writeFile(statePath, '');
	}

	async setState(object: { [key: string]: any }) {
		const statePath = path.resolve(__dirname, 'state.json');
		Object.assign(this.state, object);
		await fs.writeFile(statePath, JSON.stringify(this.state));
	}

	async startAmongCandidate (channelid: any) {
		if (this.state.activeThread !== null) {
			await this.postMessageChannelDefault(channelid, {
				text: '既に募集は開始してるよ〜 :among_us_task:',
			});
			return;
		}
		await this.postMessageChannelDefault(channelid, {
			text: '*AmongUsの募集を開始するよ〜〜* :among_us_report: :among_us_report:',
		});
		await this.postMessageChannelDefault(channelid, {
			text: '',
			blocks: getBlocks(),
		});
		const {ts}: any = await this.postStatMessage(channelid);
		this.state.activeThread = ts;
		this.state.activeChannel = channelid;
		this.activeSchedular = setInterval(() => this.checkAmongable(), AMONGABLE_CHECK_INTERVAL);
		this.setState(this.state);
	}

	async clearAmongCandidate (channelid: any) {
		if (this.state.activeThread === null) {
			await this.postMessageChannelDefault(channelid, {
				text: '今は募集してないよ... :among_us_lime_dead:',
			});
			return;
		}
		clearInterval(this.activeSchedular);
		await this.clearFile();
		this.setState({
			users: [],
			tmpUsers: [],
			activeChannel: null,
			activeThread: null,
		} as State);
		await this.postMessageChannelDefault(channelid, {
			text: '*AmongUsの募集を終了したよ〜* :among_us_cyan:',
		});
	}

	async getStatAttachments() {
		const attachments: any[] = [];
		for (const user of this.state.users) {
			attachments.push({
				color: '#ff66ff',
				author_name: await getMemberName(user.slackId),
				author_icon: await getMemberIcon(user.slackId),
				text: stripIndent`
					${user.people}人   ${printableDate(user.timeStart)} ~ ${printableDate(user.timeEnd)}
				`,
				footer: `確度 ${user.probability}`,
			});
		}
		return attachments;
	}

	async postStatMessage (channelid: any) {
		const text = '*現在の参加予定者だよ!*';
		const attachments: any[] = await this.getStatAttachments();
		return this.postMessageChannelDefault(channelid, {
			text,
			attachments,
		});
	}

	postMessageChannelDefault(channelid: any, config = {}) {
		const postingConfig: ChatPostMessageArguments = {
			username: 'AmongYou',
			icon_emoji: ':amongus:',
			channel: channelid,
			text: '',
			...config,
		};
		return this.slack.chat.postMessage(postingConfig);
	}

	postMessageDefault(receivedMessage: any, config = {}) {
		const postingConfig: ChatPostMessageArguments = {
			username: 'AmongYou',
			icon_emoji: ':amongus:',
			channel: receivedMessage.channel,
			text: '',
			...config,
		};
		return this.slack.chat.postMessage(postingConfig);
	}

	addReactionDefault (receivedMessage: any, emoji: string) {
		return this.slack.reactions.add({
			name: emoji,
			channel: receivedMessage.channel,
			timestamp: receivedMessage.ts,
		});
	}

	postMessageThreadDefault(receivedMessage: any, config = {}) {
		const postingConfig: ChatPostMessageArguments = {
			username: 'AmongYou',
			icon_emoji: ':amongus:',
			channel: receivedMessage.channel,
			thread_ts: receivedMessage.ts,
			text: '',
			...config,
		};
		return this.slack.chat.postMessage(postingConfig);
	}

	// eslint-disable-next-line require-await
	async setStartTime(slackid: string, start: string) {
		const date = parseDate(start);
		const targets = this.state.tmpUsers.filter((user) => user.slackId === slackid);
		if (targets.length === 1) {
			if (targets[0].timeEnd !== null && targets[0].timeEnd.getTime() - date.getTime() <= 20 * 60 * 1000) {
				return;
			}
			this.setState({
				...this.state,
				tmpUsers: this.state.tmpUsers.map((user) => user.slackId === slackid ? {...user, timeStart: date} : user),
			} as State);
		} else if (targets.length === 0) {
			this.state.tmpUsers.push({
				timeStart: date,
				timeEnd: null,
				slackId: slackid,
				people: null,
				probability: 100,
			});
			this.setState(this.state);
		}
	}

	// eslint-disable-next-line require-await
	async setEndTime(slackid: string, end: string) {
		const date = parseDate(end);
		const targets = this.state.tmpUsers.filter((user) => user.slackId === slackid);
		if (targets.length === 1) {
			if (targets[0].timeStart !== null && date.getTime() - targets[0].timeStart.getTime() <= 20 * 60 * 1000) {
				return;
			}
			this.setState({
				...this.state,
				tmpUsers: this.state.tmpUsers.map((user) => user.slackId === slackid ? {...user, timeEnd: date} : user),
			} as State);
		} else if (targets.length === 0) {
			this.state.tmpUsers.push({
				timeStart: null,
				timeEnd: date,
				slackId: slackid,
				people: null,
				probability: 100,
			});
			this.setState(this.state);
		}
	}

	// eslint-disable-next-line require-await
	async setNumPeople(slackid: string, numstr: string) {
		const num = Number(numstr);
		if (isNaN(num)) {
			return;
		}
		if (this.state.tmpUsers.some((user) => user.slackId === slackid)) {
			this.setState({
				...this.state,
				tmpUsers: this.state.tmpUsers.map((user) => user.slackId === slackid ? {...user, people: num} : user),
			} as State);
		} else {
			this.state.tmpUsers.push({
				timeStart: null,
				timeEnd: null,
				slackId: slackid,
				people: num,
				probability: 100,
			});
			this.setState(this.state);
		}
	}

	// eslint-disable-next-line require-await
	async joinUser(slackid: string) {
		const targetix = this.state.tmpUsers.findIndex((user) => user.slackId === slackid);
		if (targetix === -1) {
			return;
		}
		if (this.state.users.some((user) => user.slackId === slackid)) {
			this.setState({
				...this.state,
				tmpUsers: this.state.tmpUsers.filter((user) => user.slackId !== slackid),
				users: this.state.users.map((user) => user.slackId === slackid ? this.state.tmpUsers[targetix] : user),
			} as State);
		} else {
			this.setState({
				...this.state,
				tmpUsers: this.state.tmpUsers.filter((user) => user.slackId !== slackid),
				users: this.state.users.concat([this.state.tmpUsers[targetix]]),
			} as State);
		}
	}

	cancelUser(slackid: string) {
		this.setState({
			...this.state,
			users: this.state.users.filter((user) => user.slackId !== slackid),
		} as State);
	}

	checkAmongableUsers() {
		const now = new Date();
		let amongableUsers: User[] = [];
		for (const user of this.state.users) {
			if (now.getTime() >= user.timeStart.getTime() && now.getTime() <= user.timeEnd.getTime()) {
				amongableUsers.push(user);
			}
		}
		if (amongableUsers.length === 0) {
			return null;
		}
		let tmpcount = 0;
		let currentcount = amongableUsers.length;
		while (tmpcount !== currentcount) {
			tmpcount = amongableUsers.length;
			// eslint-disable-next-line no-loop-func
			amongableUsers = amongableUsers.filter((user) => user.people <= currentcount);
			currentcount = amongableUsers.length;
		}
		if (amongableUsers.length >= 1) {
			return amongableUsers;
		}
		return null;
	}

	checkAmongable() {
		const amongableUsers = this.checkAmongableUsers();
		if (amongableUsers !== null) {
			this.postMessageChannelDefault(this.state.activeChannel, {
				text: getAmongableMessage(amongableUsers),
			});
			// clear all
			this.clearAmongCandidate(this.state.activeChannel);
		}
	}
}

const getTimeOptions = () => {
	const options: any[] = [];
	timeList.forEach((t, ix) => {
		options.push({
			text: {
				type: 'plain_text',
				text: t,
				emoji: true,
			},
			value: `time-${ix}`,
		});
	});
	return options;
};

const getNumOptions = () => {
	const options: any[] = [];
	numList.forEach((t, ix) => {
		options.push({
			text: {
				type: 'plain_text',
				text: t,
				emoji: true,
			},
			value: `num-${ix}`,
		});
	});
	return options;
};

export const server = ({webClient: slack, rtmClient: rtm, messageClient: slackInteractions}: SlackInterface) => {
	const callback: FastifyPluginCallback = async (fastify, opts, next) => {
		const among = new Among({slack, rtm, slackInteractions});
		await among.initialize();

		// eslint-disable-next-line require-await
		fastify.post<SlashCommandEndpoint>('/slash/amongyou', async (req, res) => {
			 if (req.body.token !== process.env.SLACK_VERIFICATION_TOKEN) {
				res.code(400);
				return 'Bad Request';
			 }
			res.code(200);
			const args = req.body.text.split(' ');
			if (args[0] === '') {
				args[0] = 'start';
			}
			switch (args[0]) {
				case 'start':
					among.startAmongCandidate(req.body.channel_id);
					return 'OK';
				case 'clear':
					among.clearAmongCandidate(req.body.channel_id);
					return 'OK';
				default:
					return `Unknown Command: ${args[0]}`;
			}
		});

		next();
	};

	return plugin(callback);
};
