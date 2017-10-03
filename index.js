require('dotenv').config();

const {RtmClient, WebClient, CLIENT_EVENTS, RTM_EVENTS} = require('@slack/client');
const shuffle = require('shuffle-array');
const {stripIndent} = require('common-tags');

const calculator = require('./calculator.js');

const rtm = new RtmClient(process.env.SLACK_TOKEN);
const slack = new WebClient(process.env.SLACK_TOKEN);

const get牌Type = (牌) => {
	const codePoint = 牌.codePointAt(0);

	if (0x1F000 <= codePoint && codePoint <= 0x1F006) {
		return '字牌';
	}

	if (0x1F007 <= codePoint && codePoint <= 0x1F00F) {
		return '萬子';
	}

	if (0x1F010 <= codePoint && codePoint <= 0x1F018) {
		return '索子';
	}

	if (0x1F019 <= codePoint && codePoint <= 0x1F021) {
		return '筒子';
	}

	return null;
};

const 牌Orders = ['萬子', '筒子', '索子', '字牌'];

const 漢数字s = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

const 牌Names = [
	'東', '南', '西', '北', '中', '發', '白',
	...(漢数字s.map((漢数字) => `${漢数字}萬`)),
	...(漢数字s.map((漢数字) => `${漢数字}索`)),
	...(漢数字s.map((漢数字) => `${漢数字}筒`)),
];

const nameTo牌 = (name) => String.fromCodePoint(0x1F000 + 牌Names.indexOf(name));
const 牌ToName = (牌) => 牌Names[牌.codePointAt(0) - 0x1F000];

const sort = (牌s) => (
	牌s.sort((牌A, 牌B) => {
		const 牌AIndex = 牌Orders.indexOf(get牌Type(牌A));
		const 牌BIndex = 牌Orders.indexOf(get牌Type(牌B));

		if (牌AIndex !== 牌BIndex) {
			return 牌AIndex - 牌BIndex;
		}

		return 牌A.codePointAt(0) - 牌B.codePointAt(0);
	})
);

const postMessage = (channel, text) => {
	slack.chat.postMessage(channel, text, {
		username: 'mahjong',
		icon_emoji: ':mahjong:',
	});
};

const perdon = (channel) => {
	postMessage(channel, ':ha:');
};

const state = {
	phase: 'waiting',
	手牌: [],
	山牌: [],
	remaining自摸: 0,
	points: 25000,
};

const 牌List = Array(34).fill(0).map((_, index) => String.fromCodePoint(index + 0x1F000));
const 麻雀牌 = Array(136).fill(0).map((_, index) => (
	String.fromCodePoint(0x1F000 + Math.floor(index / 4))
));

rtm.on(CLIENT_EVENTS.RTM.AUTHENTICATED, (data) => {
	console.log(`Logged in as ${data.self.name} of team ${data.team.name}, but not yet connected to a channel`);
});

rtm.on(RTM_EVENTS.MESSAGE, (message) => {
	if (message.channel !== 'D1KEN3SPQ' && message.channel !== 'C7AAX50QY') {
		return;
	}

	if (message.subtype === 'bot_message') {
		return;
	}

	if (!message.text) {
		return;
	}

	const text = message.text.trim();

	if (['リーチ', 'カン', 'ポン', 'チー', 'ロン'].includes(text)) {
		perdon(message.channel);
		return;
	}

	if (text === '配牌') {
		if (state.phase !== 'waiting') {
			perdon(message.channel);
			return;
		}

		state.phase = 'gaming';
		const shuffled牌s = shuffle(麻雀牌);
		state.手牌 = sort(shuffled牌s.slice(0, 14));
		state.山牌 = shuffled牌s.slice(14);
		state.remaining自摸 = 17;
		postMessage(message.channel, `残り${state.remaining自摸}牌 https://mahjong.hakatashi.com/images/${encodeURIComponent(state.手牌.join(''))}`);
	}

	if (text.startsWith('打')) {
		if (state.phase !== 'gaming') {
			perdon(message.channel);
			return;
		}

		const 牌Name = text.slice(1);
		if (!牌Names.includes(牌Name)) {
			perdon(message.channel);
			return;
		}

		const 打牌 = nameTo牌(牌Name);

		if (!state.手牌.includes(打牌)) {
			perdon(message.channel);
			return;
		}

		state.手牌.splice(state.手牌.indexOf(打牌), 1);

		if (state.remaining自摸 === 0) {
			state.phase = 'waiting';
			const isTenpai = calculator.tenpai(state.手牌);
			if (isTenpai) {
				postMessage(message.channel, stripIndent`
					聴牌 0点
					現在の得点: ${state.points}点
				`);
			} else {
				state.points -= 3000;
				postMessage(message.channel, stripIndent`
					不聴罰符 -3000点
					現在の得点: ${state.points}点
				`);
			}
			return;
		}

		state.手牌 = sort(state.手牌).concat([state.山牌[0]]);
		state.山牌 = state.山牌.slice(1);
		state.remaining自摸--;

		postMessage(message.channel, stripIndent`
			摸${牌ToName(state.手牌[state.手牌.length - 1])} 残り${state.remaining自摸}牌
			https://mahjong.hakatashi.com/images/${encodeURIComponent(state.手牌.join(''))}
		`);
	}

	if (text === 'ツモ') {
		if (state.phase !== 'gaming') {
			perdon(message.channel);
			return;
		}

		const {agari, 役s} = calculator.agari(state.手牌);

		state.phase = 'waiting';

		if (!agari.isAgari) {
			state.points -= 12000;
			postMessage(message.channel, stripIndent`
				錯和 -12000点
				現在の得点: ${state.points}点
			`);
			return;
		}

		state.points += agari.delta[0];
		postMessage(message.channel, stripIndent`
			${役s.join('・')}
			${agari.delta[0]}点
			現在の得点: ${state.points}点
		`);
	}
});

rtm.start();
