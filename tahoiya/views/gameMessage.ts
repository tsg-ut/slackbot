import type {KnownBlock} from '@slack/web-api';
import type {StateObj, ShuffledMeaning} from '../types';

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

export const candidatesMessage = (candidates: [string, string][]): KnownBlock[] => [
	{
		type: 'section',
		text: {
			type: 'mrkdwn',
			text: 'たのしい"たほいや"を始めるよ～:clap::clap::clap:\n下のリストの中からお題にする単語を選んでボタンをクリックしてね:wink:',
		},
	},
	{
		type: 'actions',
		elements: candidates.slice(0, 5).map(([, ruby], index) => ({
			type: 'button' as const,
			text: {
				type: 'plain_text' as const,
				text: ruby,
			},
			action_id: `tahoiya_select_candidate_${index}`,
			value: ruby,
			style: 'primary' as const,
		})),
	},
	...(candidates.length > 5 ? [{
		type: 'actions' as const,
		elements: candidates.slice(5, 10).map(([, ruby], index) => ({
			type: 'button' as const,
			text: {
				type: 'plain_text' as const,
				text: ruby,
			},
			action_id: `tahoiya_select_candidate_${index + 5}`,
			value: ruby,
			style: 'primary' as const,
		})),
	}] : []),
];

export const meaningsPhaseMessage = (state: StateObj, endTime: number): KnownBlock[] => {
	if (!state.theme) return [];
	
	const getMemberMention = (user: string) => {
		if (user === 'tahoiyabot-01') return 'たほいやAIくん1号 (仮)';
		if (user === 'tahoiyabot-02') return 'たほいやAIくん2号 (仮)';
		return `<@${user}>`;
	};

	const humanCount = Array.from(state.meanings.keys()).filter((user) => user.startsWith('U')).length;
	const participantText = humanCount > 0 ? `\n登録済み: ${[...state.meanings.keys()].map(getMemberMention).join(', ')}` : '';

	return [
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: state.author 
					? `今日のデイリーたほいやが始まるよ:checkered_flag::checkered_flag::checkered_flag:\n出題者: ${getMemberMention(state.author)}\n\n今日のお題は *「${state.theme.ruby}」* だよ:v:\n参加者は90分以内にこの単語の意味を考えて下のボタンから登録してね:relaxed:${participantText}`
					: `お題を *「${state.theme.ruby}」* にセットしたよ:v:\n参加者は3分以内にこの単語の意味を考えて下のボタンから登録してね:relaxed:${participantText}`,
			},
		},
		{
			type: 'actions',
			elements: [
				{
					type: 'button',
					text: {
						type: 'plain_text',
						text: '意味を登録',
						emoji: true,
					},
					action_id: 'tahoiya_register_meaning',
					style: 'primary',
				},
				{
					type: 'button',
					text: {
						type: 'plain_text',
						text: 'コメント',
						emoji: true,
					},
					action_id: 'tahoiya_add_comment',
				},
			],
		},
		{
			type: 'context',
			elements: [
				{
					type: 'plain_text',
					text: `終了予定時刻: <!date^${Math.floor(endTime / 1000)}^{time}|${new Date(endTime).toLocaleTimeString()}>`,
				},
			],
		},
	];
};

export const bettingPhaseMessage = (state: StateObj, endTime: number): KnownBlock[] => {
	if (!state.theme || !state.shuffledMeanings) return [];

	const getMemberMention = (user: string) => {
		if (user === 'tahoiyabot-01') return 'たほいやAIくん1号 (仮)';
		if (user === 'tahoiyabot-02') return 'たほいやAIくん2号 (仮)';
		return `<@${user}>`;
	};

	const participants = [...state.meanings.keys()].filter((user) => user.startsWith('U'));

	return [
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: `${participants.map(getMemberMention).join(' ')}\nベッティングタイムが始まるよ～:open_hands::open_hands::open_hands:\n下のリストから *${state.theme.ruby}* の正しい意味だと思うものを選んで、ボタンからベットしてね:wink:\n全員ぶん出揃うか${state.author === null ? '3' : '30'}分が経過すると結果発表だよ:sunglasses:`,
			},
		},
		{
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: state.shuffledMeanings.map((meaning, index) => `${index + 1}. ${meaning.text}`).join('\n\n'),
			},
		},
		{
			type: 'actions',
			elements: [
				{
					type: 'button',
					text: {
						type: 'plain_text',
						text: 'ベットする',
						emoji: true,
					},
					action_id: 'tahoiya_place_bet',
					style: 'primary',
				},
			],
		},
		{
			type: 'context',
			elements: [
				{
					type: 'plain_text',
					text: `終了予定時刻: <!date^${Math.floor(endTime / 1000)}^{time}|${new Date(endTime).toLocaleTimeString()}>`,
				},
			],
		},
	];
};

export const startGameMessage = (): KnownBlock[] => [
	{
		type: 'section',
		text: {
			type: 'mrkdwn',
			text: 'たほいやゲームを開始します！',
		},
	},
	{
		type: 'actions',
		elements: [
			{
				type: 'button',
				text: {
					type: 'plain_text',
					text: 'たほいやを始める',
					emoji: true,
				},
				action_id: 'tahoiya_start_game',
				style: 'primary',
			},
			{
				type: 'button',
				text: {
					type: 'plain_text',
					text: 'デイリーたほいや お題登録',
					emoji: true,
				},
				action_id: 'tahoiya_register_daily_theme',
			},
		],
	},
];