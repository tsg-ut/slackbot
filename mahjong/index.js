const {stripIndent} = require('common-tags');
const fs = require('fs');
const qs = require('querystring');
const {promisify} = require('util');
const {chunk, shuffle} = require('lodash');
const path = require('path');
const assert = require('assert');

const calculator = require('./calculator.js');
const savedState = (() => {
	try {
		// eslint-disable-next-line global-require
		return require('./current-point.json');
	} catch (e) {
		return {
			points: 25000,
			wins: 0,
			loses: 0,
		};
	}
})();


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
	'赤五萬', '赤五索', '赤五筒',
];

const nameTo牌 = (name) => {
	const normalized = name.startsWith('赤') ? name.slice(1) : name;
	const 牌 = String.fromCodePoint(0x1F000 + 牌Names.indexOf(normalized));
	if (name.startsWith('赤')) {
		return `${牌}\uFE00`;
	}
	return 牌;
};

const 牌ToName = (牌) => {
	const normalized牌 = 牌.replace(/\uFE00$/, '');
	const name = 牌Names[normalized牌.codePointAt(0) - 0x1F000];
	if (牌.endsWith('\uFE00')) {
		return `赤${name}`;
	}
	return name;
};

const sort = (牌s) => (
	牌s.sort((牌A, 牌B) => {
		const 牌AIndex = 牌Orders.indexOf(get牌Type(牌A));
		const 牌BIndex = 牌Orders.indexOf(get牌Type(牌B));

		if (牌AIndex !== 牌BIndex) {
			return 牌AIndex - 牌BIndex;
		}

		if (牌A.codePointAt(0) !== 牌B.codePointAt(0)) {
			return 牌A.codePointAt(0) - 牌B.codePointAt(0);
		}

		return Array.from(牌B).length - Array.from(牌A).length;
	})
);

const state = {
	phase: 'waiting',
	mode: '四人',
	手牌: [],
	壁牌: [],
	ドラ表示牌s: [],
	remaining自摸: 0,
	嶺上牌Count: 4,
	抜きドラCount: 0,
	points: savedState.points,
	リーチTurn: null,
	wins: savedState.wins,
	loses: savedState.loses,
};

const 麻雀牌 = Array(136).fill(0).map((_, index) => {
	const 牌 = String.fromCodePoint(0x1F000 + Math.floor(index / 4));
	const 同牌Index = index % 4;

	if (
		(牌 === '🀋' && 同牌Index === 0) ||
		(牌 === '🀔' && 同牌Index === 0) ||
		(牌 === '🀝' && (同牌Index === 0 || 同牌Index === 1))
	) {
		return `${牌}\uFE00`;
	}

	return 牌;
});

const 麻雀牌Forサンマ = 麻雀牌.filter((牌) => {
	const codePoint = 牌.codePointAt(0);
	return codePoint < 0x1F008 || codePoint > 0x1F00E;
});

assert.strictEqual(麻雀牌Forサンマ.length, 108);

const saveState = async () => {
	await promisify(fs.writeFile)(path.join(__dirname, 'current-point.json'), JSON.stringify({
		points: state.points,
		wins: state.wins,
		loses: state.loses,
	}));
};

module.exports = (clients) => {
	const {rtmClient: rtm, webClient: slack} = clients;

	rtm.on('message', async (message) => {
		const postMessage = (text, {手牌 = null, 王牌 = null, 王牌Status = 'normal'} = {}) => {
			slack.chat.postMessage({
				channel: message.channel,
				text,
				username: 'mahjong',
				// eslint-disable-next-line camelcase
				icon_emoji: ':mahjong:',
				...(手牌 === null ? {} : {
					attachments: [{
						// eslint-disable-next-line camelcase
						image_url: `https://mahjong.hakatashi.com/images/${encodeURIComponent(手牌.join(''))}?${
							qs.encode({
								...((王牌 === null) ? {} : {
									王牌: 王牌.join(''),
									王牌Status,
								}),
								color: state.mode === '四人' ? 'white' : 'black',
							})
						}`,
						fallback: 手牌.join(''),
					}],
				}),
			});
		};

		const perdon = () => {
			postMessage(':ha:');
		};

		const generate王牌 = (裏ドラ表示牌s = []) => {
			const 嶺上牌s = [
				...Array((state.mode === '四人' ? 4 : 8) - state.嶺上牌Count).fill('\u2003'),
				...Array(state.嶺上牌Count).fill('🀫'),
			];

			return [
				...(state.mode === '四人' ? [嶺上牌s[0], 嶺上牌s[2]] : [嶺上牌s[0], 嶺上牌s[2], 嶺上牌s[4], 嶺上牌s[6]]),
				...state.ドラ表示牌s,
				...Array((state.mode === '四人' ? 5 : 3) - state.ドラ表示牌s.length).fill('🀫'),

				...(state.mode === '四人' ? [嶺上牌s[1], 嶺上牌s[3]] : [嶺上牌s[1], 嶺上牌s[3], 嶺上牌s[5], 嶺上牌s[7]]),
				...裏ドラ表示牌s,
				...Array((state.mode === '四人' ? 5 : 3) - 裏ドラ表示牌s.length).fill('🀫'),
			];
		};

		const checkPoints = async () => {
			if (state.points < 0) {
				state.loses++;
				state.points = 25000;
				await saveState();
				postMessage(stripIndent`
					ハコ割れしました。点数をリセットします。
					通算成績: ${state.wins}勝${state.loses}敗
				`);
			} else if (state.points > 50000) {
				state.wins++;
				state.points = 25000;
				await saveState();
				postMessage(stripIndent`
					勝利しました。点数をリセットします。
					通算成績: ${state.wins}勝${state.loses}敗
				`);
			}
		};

		if (message.channel !== process.env.CHANNEL_SANDBOX) {
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
			state.mode = '四人';
			state.抜きドラCount = 0;
			state.嶺上牌Count = 4;
			const shuffled牌s = shuffle(麻雀牌);
			state.手牌 = sort(shuffled牌s.slice(0, 14));
			state.ドラ表示牌s = shuffled牌s.slice(14, 15);
			state.壁牌 = shuffled牌s.slice(15);
			state.remaining自摸 = 17;
			state.points -= 1500;
			await saveState();

			postMessage(stripIndent`
				場代 -1500点
				現在の得点: ${state.points}点

				残り${state.remaining自摸}牌
			`, {
				手牌: state.手牌,
				王牌: generate王牌(),
			});
			return;
		}

		if (text === 'サンマ') {
			if (state.phase !== 'waiting') {
				perdon();
				return;
			}

			state.phase = 'gaming';
			state.mode = '三人';
			state.抜きドラCount = 0;
			state.嶺上牌Count = 8;
			const shuffled牌s = shuffle(麻雀牌Forサンマ);
			state.手牌 = sort(shuffled牌s.slice(0, 14));
			state.ドラ表示牌s = shuffled牌s.slice(14, 15);
			state.壁牌 = shuffled牌s.slice(15);
			state.remaining自摸 = 17;
			state.points -= 6000;
			await saveState();

			postMessage(stripIndent`
				場代 -6000点
				現在の得点: ${state.points}点

				残り${state.remaining自摸}牌
			`, {
				手牌: state.手牌,
				王牌: generate王牌(),
			});
			return;
		}

		if (text === '残り牌') {
			if (state.phase !== 'gaming') {
				perdon();
				return;
			}

			const 残り牌List = new Array(34).fill(0);
			state.壁牌.forEach((牌) => {
				残り牌List[牌.codePointAt(0) - 0x1F000]++;
			});
			postMessage(stripIndent`
				萬子: ${chunk(残り牌List.slice(7, 16), 3).map((numbers) => numbers.join('')).join(' ')}
				筒子: ${chunk(残り牌List.slice(25, 34), 3).map((numbers) => numbers.join('')).join(' ')}
				索子: ${chunk(残り牌List.slice(16, 25), 3).map((numbers) => numbers.join('')).join(' ')}
				${牌Names.slice(0, 7).map((name, index) => `${name}${残り牌List[index]}`).join(' ')}
			`);
			return;
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
					await saveState();
					postMessage(stripIndent`
						不聴罰符 -3000点
						現在の得点: ${state.points}点
					`);
				}

				await checkPoints();
				return;
			}

			state.手牌 = sort(state.手牌).concat([state.壁牌[0]]);
			state.壁牌 = state.壁牌.slice(1);
			state.remaining自摸--;

			postMessage(stripIndent`
				摸${牌ToName(state.手牌[state.手牌.length - 1])} 残り${state.remaining自摸}牌
			`, {
				手牌: state.手牌,
				王牌: generate王牌(),
			});
		}

		if (text === 'ペー' || text === 'ぺー') {
			if (state.phase !== 'gaming' || state.mode !== '三人') {
				perdon();
				return;
			}

			if (!state.手牌.includes('🀃')) {
				perdon();
				return;
			}

			const 北Index = state.手牌.indexOf('🀃');
			state.手牌.splice(北Index, 1);

			state.抜きドラCount++;
			state.嶺上牌Count--;
			state.手牌 = sort(state.手牌).concat([state.壁牌[0]]);
			state.壁牌 = state.壁牌.slice(1);

			postMessage(stripIndent`
				抜きドラ ${state.抜きドラCount}牌 残り${state.remaining自摸}牌
			`, {
				手牌: state.手牌,
				王牌: generate王牌(),
			});
			return;
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

			let new手牌 = null;
			if (instruction === 'ツモ切り') {
				new手牌 = state.手牌.slice(0, -1);
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

				new手牌 = state.手牌.slice();
				new手牌.splice(new手牌.indexOf(打牌), 1);
			}

			if (!calculator.tenpai(new手牌)) {
				perdon();
				return;
			}

			state.手牌 = sort(new手牌);
			state.phase = 'リーチ';
			state.リーチTurn = state.remaining自摸;

			// TODO: フリテン
			while (state.remaining自摸 > 0) {
				state.remaining自摸--;

				const 河牌Count = state.mode === '三人' ? 3 : 4;
				const 河牌s = state.壁牌.slice(0, 河牌Count);
				state.壁牌 = state.壁牌.slice(河牌Count);

				const 当たり牌Index = 河牌s.findIndex((牌) => {
					const {agari} = calculator.agari(state.手牌.concat([牌]), {isRiichi: false});
					return agari.isAgari;
				});

				if (当たり牌Index !== -1) {
					const 裏ドラ表示牌s = state.壁牌.slice(0, state.ドラ表示牌s.length);
					state.壁牌 = state.壁牌.slice(state.ドラ表示牌s.length);

					const ドラs = [...state.ドラ表示牌s, ...裏ドラ表示牌s];
					const 抜きドラ = state.抜きドラCount * (ドラs.filter((ドラ) => ドラ === '🀂').length + 1);

					const {agari, 役s} = calculator.agari(state.手牌.concat([河牌s[当たり牌Index]]), {
						doraHyouji: state.ドラ表示牌s.map((ドラ表示牌) => (state.mode === '三人' && ドラ表示牌 === '🀇') ? '🀎' : ドラ表示牌),
						uraDoraHyouji: 裏ドラ表示牌s.map((ドラ表示牌) => (state.mode === '三人' && ドラ表示牌 === '🀇') ? '🀎' : ドラ表示牌),
						isHaitei: state.remaining自摸 === 0 && 当たり牌Index === 河牌Count - 1,
						isVirgin: false,
						isRiichi: true,
						isDoubleRiichi: state.リーチTurn === 17,
						isIppatsu: state.リーチTurn - state.remaining自摸 === 1,
						isRon: 当たり牌Index !== 河牌Count - 1,
						additionalDora: 抜きドラ,
					});

					state.points += agari.delta[0];
					await saveState();
					postMessage(stripIndent`
						河${河牌s.slice(0, Math.min(当たり牌Index + 1, 河牌Count - 1)).map(牌ToName).join('・')}${当たり牌Index === 河牌Count - 1 ? ` 摸${牌ToName(河牌s[河牌s.length - 1])}` : ''}
						${当たり牌Index === 河牌Count - 1 ? 'ツモ!!!' : 'ロン!!!'}

						${役s.join('・')}
						${agari.delta[0]}点
						現在の得点: ${state.points}点
					`, {
						手牌: state.手牌.concat([河牌s[当たり牌Index]]),
						王牌: generate王牌(裏ドラ表示牌s),
						王牌Status: 'open',
					});
					await checkPoints();
					state.phase = 'waiting';
					return;
				}

				postMessage(stripIndent`
					河${河牌s.slice(0, 河牌Count - 1).map(牌ToName).join('・')} 摸${牌ToName(河牌s[河牌s.length - 1])} 残り${state.remaining自摸}牌
				`, {
					手牌: state.手牌.concat([河牌s[河牌s.length - 1]]),
					王牌: generate王牌(),
				});

				await new Promise((resolve) => {
					setTimeout(resolve, 3000);
				});
			}

			state.phase = 'waiting';
			const isTenpai = calculator.tenpai(state.手牌);
			if (isTenpai) {
				state.points -= 1000;
				await saveState();
				postMessage(stripIndent`
					流局 供託点 -1000点
					現在の得点: ${state.points}点
				`);
			} else {
				state.points -= 12000;
				await saveState();
				postMessage(stripIndent`
					流局 不聴立直 -12000点
					現在の得点: ${state.points}点
				`);
			}

			await checkPoints();
			return;
		}

		if (text === 'ツモ') {
			if (state.phase !== 'gaming') {
				perdon();
				return;
			}

			const {agari, 役s} = calculator.agari(state.手牌, {
				doraHyouji: state.ドラ表示牌s,
				isHaitei: state.remaining自摸 === 0,
				isVirgin: state.remaining自摸 === 17,
				additionalDora: state.抜きドラCount,
			});

			state.phase = 'waiting';

			if (!agari.isAgari) {
				state.points -= 12000;
				await saveState();
				postMessage(stripIndent`
					錯和 -12000点
					現在の得点: ${state.points}点
				`);
				await checkPoints();
				return;
			}

			state.points += agari.delta[0];
			await saveState();
			postMessage(stripIndent`
				ツモ!!!
				${役s.join('・')}
				${agari.delta[0]}点
				現在の得点: ${state.points}点
			`);
			await checkPoints();
		}
	});
};
