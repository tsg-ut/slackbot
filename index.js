require('dotenv').config();

process.on('unhandledRejection', (error) => {
	console.error(error);
});

const {RtmClient, WebClient, CLIENT_EVENTS, RTM_EVENTS} = require('@slack/client');
const shuffle = require('shuffle-array');
const {stripIndent} = require('common-tags');
const fs = require('fs');

const calculator = require('./calculator.js');
const currentPoint = (() => {
	try {
		// eslint-disable-next-line global-require
		return require('./current-point.json');
	} catch (e) {
		return 25000;
	}
})();

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

const state = {
	phase: 'waiting',
	手牌: [],
	壁牌: [],
	remaining自摸: 0,
	points: currentPoint,
	リーチTurn: null,
};

const 麻雀牌 = Array(136).fill(0).map((_, index) => (
	String.fromCodePoint(0x1F000 + Math.floor(index / 4))
));

const saveState = () => {
	fs.writeFile('current-point.json', JSON.stringify(state.points));
};

rtm.on(CLIENT_EVENTS.RTM.AUTHENTICATED, (data) => {
	console.log(`Logged in as ${data.self.name} of team ${data.team.name}`);
});

rtm.on(RTM_EVENTS.MESSAGE, async (message) => {
	const postMessage = (text, 手牌 = null) => {
		slack.chat.postMessage(message.channel, text, {
			username: 'mahjong',
			// eslint-disable-next-line camelcase
			icon_emoji: ':mahjong:',
			...(手牌 === null ? {} : {
				attachments: [{
					// eslint-disable-next-line camelcase
					image_url: `https://mahjong.hakatashi.com/images/${encodeURIComponent(手牌.join(''))}`,
					fallback: 手牌.join(''),
				}],
			}),
		});
	};

	const perdon = () => {
		postMessage(':ha:');
	};

	if (message.channel !== process.env.CHANNEL) {
		return;
	}

	if (message.subtype === 'bot_message') {
		return;
	}

	if (!message.text) {
		return;
	}

	const text = message.text.trim();

	if (['カン', 'ポン', 'チー', 'ロン'].includes(text)) {
		perdon();
		return;
	}

	if (text === '配牌') {
		if (state.phase !== 'waiting') {
			perdon();
			return;
		}

		state.phase = 'gaming';
		const shuffled牌s = shuffle(麻雀牌);
		state.手牌 = sort(shuffled牌s.slice(0, 14));
		state.壁牌 = shuffled牌s.slice(14);
		state.remaining自摸 = 17;
		postMessage(`残り${state.remaining自摸}牌`, state.手牌);
	}

	if (text.startsWith('打') || text === 'ツモ切り') {
		if (state.phase !== 'gaming') {
			perdon();
			return;
		}

		if (text === 'ツモ切り') {
			state.手牌 = state.手牌.slice(0, -1);
		} else {
			const 牌Name = text.slice(1);
			if (!牌Names.includes(牌Name)) {
				perdon();
				return;
			}

			const 打牌 = nameTo牌(牌Name);

			if (!state.手牌.includes(打牌)) {
				perdon();
				return;
			}

			state.手牌.splice(state.手牌.indexOf(打牌), 1);
		}

		if (state.remaining自摸 === 0) {
			state.phase = 'waiting';
			const isTenpai = calculator.tenpai(state.手牌);
			if (isTenpai) {
				postMessage(stripIndent`
					聴牌 0点
					現在の得点: ${state.points}点
				`);
			} else {
				state.points -= 3000;
				saveState();
				postMessage(stripIndent`
					不聴罰符 -3000点
					現在の得点: ${state.points}点
				`);
			}
			return;
		}

		state.手牌 = sort(state.手牌).concat([state.壁牌[0]]);
		state.壁牌 = state.壁牌.slice(1);
		state.remaining自摸--;

		postMessage(stripIndent`
			摸${牌ToName(state.手牌[state.手牌.length - 1])} 残り${state.remaining自摸}牌
		`, state.手牌);
	}

	if (text.startsWith('リーチ ')) {
		if (state.phase !== 'gaming') {
			perdon();
			return;
		}

		const instruction = text.slice('リーチ '.length);

		if (!instruction.startsWith('打') && instruction !== 'ツモ切り') {
			perdon();
			return;
		}

		if (instruction === 'ツモ切り') {
			state.手牌 = state.手牌.slice(0, -1);
		} else {
			const 牌Name = instruction.slice(1);
			if (!牌Names.includes(牌Name)) {
				perdon();
				return;
			}

			const 打牌 = nameTo牌(牌Name);

			if (!state.手牌.includes(打牌)) {
				perdon();
				return;
			}

			state.手牌.splice(state.手牌.indexOf(打牌), 1);
		}

		state.手牌 = sort(state.手牌);
		state.phase = 'リーチ';
		state.リーチTurn = state.remaining自摸;

		// TODO: フリテン
		while (state.remaining自摸 > 0) {
			state.remaining自摸--;

			const 河牌s = state.壁牌.slice(0, 4);
			state.壁牌 = state.壁牌.slice(4);

			const 当たり牌Index = 河牌s.findIndex((牌) => {
				const {agari} = calculator.agari(state.手牌.concat([牌]), {isRiichi: false});
				return agari.isAgari;
			});

			if (当たり牌Index !== -1) {
				const {agari, 役s} = calculator.agari(state.手牌.concat([河牌s[当たり牌Index]]), {
					isHaitei: state.remaining自摸 === 0 && 当たり牌Index === 3,
					isVirgin: false,
					isRiichi: true,
					isDoubleRiichi: state.リーチTurn === 17,
					isIppatsu: state.リーチTurn - state.remaining自摸 === 1,
					isRon: 当たり牌Index !== 3,
				});

				state.points += agari.delta[0];
				saveState();
				postMessage(stripIndent`
					河${河牌s.slice(0, Math.min(当たり牌Index + 1, 3)).map(牌ToName).join('・')}${当たり牌Index === 3 ? ` 摸${牌ToName(河牌s[河牌s.length - 1])}` : ''}
					${当たり牌Index === 3 ? 'ツモ!!!' : 'ロン!!!'}

					${役s.join('・')}
					${agari.delta[0]}点
					現在の得点: ${state.points}点
				`, state.手牌.concat([河牌s[当たり牌Index]]));
				state.phase = 'waiting';
				return;
			}

			postMessage(stripIndent`
				河${河牌s.slice(0, 3).map(牌ToName).join('・')} 摸${牌ToName(河牌s[河牌s.length - 1])} 残り${state.remaining自摸}牌
			`, state.手牌.concat([河牌s[3]]));

			await new Promise((resolve) => {
				setTimeout(resolve, 3000);
			});
		}

		state.phase = 'waiting';
		const isTenpai = calculator.tenpai(state.手牌);
		if (isTenpai) {
			state.points -= 1000;
			saveState();
			postMessage(stripIndent`
				流局 供託点 -1000点
				現在の得点: ${state.points}点
			`);
		} else {
			state.points -= 12000;
			saveState();
			postMessage(stripIndent`
				流局 不聴立直 -12000点
				現在の得点: ${state.points}点
			`);
		}
		return;
	}

	if (text === 'ツモ') {
		if (state.phase !== 'gaming') {
			perdon();
			return;
		}

		const {agari, 役s} = calculator.agari(state.手牌, {isHaitei: state.remaining自摸 === 0, isVirgin: state.remaining自摸 === 17});

		state.phase = 'waiting';

		if (!agari.isAgari) {
			state.points -= 12000;
			saveState();
			postMessage(stripIndent`
				錯和 -12000点
				現在の得点: ${state.points}点
			`);
			return;
		}

		state.points += agari.delta[0];
		saveState();
		postMessage(stripIndent`
			ツモ!!!
			${役s.join('・')}
			${agari.delta[0]}点
			現在の得点: ${state.points}点
		`);
	}
});

rtm.start();
