const assert = require('assert');
const fs = require('fs');
const path = require('path');
const qs = require('querystring');
const {promisify} = require('util');
const {v2: cloudinary} = require('cloudinary');
const {source} = require('common-tags');
const {chunk, shuffle, sampleSize, sample, random} = require('lodash');
const {unlock, increment} = require('../achievements');
const {AteQuiz} = require('../atequiz/index.ts');
const {blockDeploy} = require('../deploy/index.ts');
const {Mutex} = require('async-mutex');
const calculator = require('./calculator.js');

const mutex = new Mutex();

const savedState = (() => {
	try {
		const defaultSavedState = {
			points: 25000,
			wins: 0,
			loses: 0,
			大麻雀Points: 350000,
			大麻雀Wins: 0,
			大麻雀Loses: 0,
		};
		// eslint-disable-next-line global-require
		return Object.assign(defaultSavedState, require('./current-point.json'));
	} catch (e) {
		return {
			points: 25000,
			wins: 0,
			loses: 0,
			大麻雀Points: 350000,
			大麻雀Wins: 0,
			大麻雀Loses: 0,
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

const normalize打牌Command = (text) => {
	if (text === 'd') {
		return 'ツモ切り';
	}
	const 打牌Command = text
		.replace(':nanyanen-nannanode:', '南').replace(':ナンやねん-ナンなので:', '南')
		.replace('d', '打')
		.replace('r', '赤')
		.replace(/[1-7]z/g, (match) => 牌Names[parseInt(match) - 1])
		.replace(/[1-9]/g, (match) => 漢数字s[parseInt(match) - 1])
		.replace('m', '萬').replace('s', '索').replace('p', '筒')
		.replace('E', '東').replace('S', '南').replace('W', '西').replace('N', '北')
		.replace('D', '白').replace('F', '發').replace('C', '中');
	return 打牌Command;
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
	thread: null,
	deployUnblock: null,
	大麻雀: false,
	大麻雀Points: savedState.大麻雀Points,
	大麻雀Wins: savedState.大麻雀Wins,
	大麻雀Loses: savedState.大麻雀Loses,
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
		大麻雀Points: state.大麻雀Points,
		大麻雀Wins: state.大麻雀Wins,
		大麻雀Loses: state.大麻雀Loses,
	}));
};

const uploadImage = async (imageUrl) => {
	const response = await new Promise((resolve, reject) => {
		cloudinary.uploader.upload(imageUrl, (error, data) => {
			if (error) {
				reject(error);
			} else {
				resolve(data);
			}
		});
	});
	return response.secure_url;
};

class TenpaiAteQuiz extends AteQuiz {
	constructor(clients, problem, option) {
		super(clients, problem, option);
		this.answeredUsers = new Set();
	}

	judge(answer, user) {
		const normalizedAnswer = answer.replace(/\s/g, '').split('').sort().join('');

		if (answer !== 'ノーテン' && !normalizedAnswer.match(/^\d+$/)) {
			// invalid answer
			return false;
		}

		if (this.answeredUsers.has(user)) {
			return false;
		}
		this.answeredUsers.add(user);

		return this.problem.correctAnswers.map((correctAnswer) => (
			correctAnswer.replace(/\s/g, '').split('').sort().join('')
		)).includes(normalizedAnswer);
	}

	waitSecGen() {
		return 60;
	}
}

module.exports = (clients) => {
	const {eventClient, webClient: slack} = clients;

	eventClient.on('message', async (message) => {
		const postMessage = (text, {手牌 = null, 王牌 = null, 王牌Status = 'normal', mode = 'thread'} = {}) => (
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
				...(mode === 'initial' ? {} : {thread_ts: state.thread}),
				...(mode === 'broadcast' ? {reply_broadcast: true} : {}),
			})
		);

		const perdon = () => {
			postMessage(':ha:');
		};

		const perdonBroadcast = () => {
			postMessage(':ha:', {mode: 'broadcast'});
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
				postMessage(source`
					ハコ割れしました。点数をリセットします。
					通算成績: ${state.wins}勝${state.loses}敗
				`, {
					mode: 'broadcast',
				});
			} else if (state.points > 50000) {
				state.wins++;
				state.points = 25000;
				await saveState();
				postMessage(source`
					勝利しました。点数をリセットします。
					通算成績: ${state.wins}勝${state.loses}敗
				`, {
					mode: 'broadcast',
				});
			}
			if (state.大麻雀Points < 0) {
				state.大麻雀Loses++;
				state.大麻雀Points = 350000;
				await saveState();
				postMessage(source`
					*大麻雀 役満縛り*

					ハコ割れしました。点数をリセットします。
					通算成績: ${state.大麻雀Wins}勝${state.大麻雀Loses}敗
				`, {
					mode: 'broadcast',
				});
			} else if (state.大麻雀Points > 600000) {
				state.大麻雀Wins++;
				state.大麻雀Points = 350000;
				await saveState();
				postMessage(source`
					*大麻雀 役満縛り*

					勝利しました。点数をリセットします。
					通算成績: ${state.大麻雀Wins}勝${state.大麻雀Loses}敗
				`, {
					mode: 'broadcast',
				});
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

		if (text === '配牌a') {
			if (state.phase !== 'waiting') {
				perdonBroadcast();
				return;
			}

			state.deployUnblock = await blockDeploy('mahjong');
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
			state.大麻雀 = false;
			await saveState();

			const {ts} = await postMessage(source`
				場代 -1500点
				現在の得点: ${state.points}点

				残り${state.remaining自摸}牌

				コマンドをスレッドで打ち込んでください。
			`, {
				手牌: state.手牌,
				王牌: generate王牌(),
				mode: 'initial',
			});

			state.thread = ts;
			await saveState();

			return;
		}

		if (text === 'サンマ') {
			if (state.phase !== 'waiting') {
				perdonBroadcast();
				return;
			}

			state.deployUnblock = await blockDeploy('mahjong');
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
			state.大麻雀 = false;
			await saveState();

			const {ts} = await postMessage(source`
				場代 -6000点
				現在の得点: ${state.points}点

				残り${state.remaining自摸}牌

				コマンドをスレッドで打ち込んでください。
			`, {
				手牌: state.手牌,
				王牌: generate王牌(),
				mode: 'initial',
			});

			state.thread = ts;
			await saveState();

			return;
		}

		if (text === '大麻雀') {
			if (state.phase !== 'waiting') {
				perdonBroadcast();
				return;
			}

			state.deployUnblock = await blockDeploy('mahjong');
			state.phase = 'gaming';
			state.mode = '三人';
			state.抜きドラCount = 0;
			state.嶺上牌Count = 8;
			const shuffled牌s = shuffle(麻雀牌Forサンマ);
			state.手牌 = sort(shuffled牌s.slice(0, 14));
			state.ドラ表示牌s = shuffled牌s.slice(14, 15);
			state.壁牌 = shuffled牌s.slice(15);
			state.remaining自摸 = 20;
			state.大麻雀Points -= 6000;
			state.大麻雀 = true;
			await saveState();

			const {ts} = await postMessage(source`
				*大麻雀 役満縛り*

				場代 -6000点
				現在の得点: ${state.大麻雀Points}点

				残り${state.remaining自摸}牌

				コマンドをスレッドで打ち込んでください。
			`, {
				手牌: state.手牌,
				王牌: generate王牌(),
				mode: 'initial',
			});

			state.thread = ts;
			await saveState();

			return;
		}

		if (message.thread_ts && state.thread === message.thread_ts) {
			if (['カン', 'ポン', 'チー', 'ロン'].includes(text)) {
				if (text === 'カン') {
					await unlock(message.user, 'mahjong-invalid-kan');
				}
				perdon();
				return;
			}

			if (text === '残り牌') {
				if (state.phase !== 'gaming') {
					perdon();
					return;
				}

				const 残り牌List = new Array(34).fill(0);
				for (const 牌 of state.壁牌) {
					残り牌List[牌.codePointAt(0) - 0x1F000]++;
				}
				postMessage(source`
					萬子: ${chunk(残り牌List.slice(7, 16), 3).map((numbers) => numbers.join('')).join(' ')}
					筒子: ${chunk(残り牌List.slice(25, 34), 3).map((numbers) => numbers.join('')).join(' ')}
					索子: ${chunk(残り牌List.slice(16, 25), 3).map((numbers) => numbers.join('')).join(' ')}
					${牌Names.slice(0, 7).map((name, index) => `${name}${残り牌List[index]}`).join(' ')}
				`);
				return;
			}

			if(text === 'ドラ牌') {
				if (state.phase !== 'gaming') {
					perdon();
					return;
				}
				
				postMessage(source`
					${state.ドラ表示牌s.map((牌) => 牌ToName(牌)).join(' ')}
				`);
				return;
			}

			if (text.startsWith('打') || text.startsWith('d') || text === 'ツモ切り') {
				const instruction = normalize打牌Command(text);

				if (state.phase !== 'gaming') {
					perdon();
					return;
				}

				if (instruction === 'ツモ切り') {
					if (state.mode === '四人' && state.手牌[state.手牌.length - 1] === '🀟') {
						await unlock(message.user, 'mahjong-ikeda');
					}

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

					if (state.mode === '四人' && 打牌 === '🀟') {
						await unlock(message.user, 'mahjong-ikeda');
					}
				}

				if (state.remaining自摸 === 0) {
					state.deployUnblock();
					state.phase = 'waiting';
					const isTenpai = calculator.tenpai(state.手牌);
					if (isTenpai) {
						postMessage(source`
							${state.大麻雀 ? '*大麻雀 役満縛り*\n\n' : ''}聴牌 0点
							現在の得点: ${state.大麻雀 ? state.大麻雀Points : state.points}点
						`, {
							mode: 'broadcast',
						});
					} else {
						if (state.大麻雀) {
							state.大麻雀Points -= 3000;
						} else {
							state.points -= 3000;
						}

						await saveState();
						postMessage(source`
							${state.大麻雀 ? '*大麻雀 役満縛り*\n\n' : ''}不聴罰符 -3000点
							現在の得点: ${state.大麻雀 ? state.大麻雀Points : state.points}点
						`, {
							mode: 'broadcast',
						});
					}

					state.thread = null;
					await saveState();

					await checkPoints();
					return;
				}

				state.手牌 = sort(state.手牌).concat([state.壁牌[0]]);
				state.壁牌 = state.壁牌.slice(1);
				state.remaining自摸--;

				postMessage(source`
					摸${牌ToName(state.手牌[state.手牌.length - 1])} 残り${state.remaining自摸}牌
				`, {
					手牌: state.手牌,
					王牌: generate王牌(),
				});
			}

			if (text === 'ペー' || text === 'ぺー' || text === 'p') {
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

				postMessage(source`
					抜きドラ ${state.抜きドラCount}牌 残り${state.remaining自摸}牌
				`, {
					手牌: state.手牌,
					王牌: generate王牌(),
				});
				return;
			}

			if (text.startsWith('リーチ ') || text.startsWith('r')) {
				if (state.phase !== 'gaming') {
					perdon();
					return;
				}

				const rawInstruction = text.slice(text.startsWith('リーチ ') ? 'リーチ '.length : 'r'.length);

				if (!(rawInstruction.startsWith('打') || rawInstruction.startsWith('d') || rawInstruction === 'ツモ切り')) {
					perdon();
					return;
				}
				const instruction = normalize打牌Command(rawInstruction);

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
							isDoubleRiichi: state.リーチTurn === (state.大麻雀 ? 20 : 17),
							isIppatsu: state.リーチTurn - state.remaining自摸 === 1,
							isRon: 当たり牌Index !== 河牌Count - 1,
							additionalDora: 抜きドラ,
						});

						let is錯和 = false;

						if (state.大麻雀) {
							if (agari.delta[0] < 48000) {
								is錯和 = true;
								agari.delta[0] = -12000;
							}
							state.大麻雀Points += agari.delta[0];
						} else {
							state.points += agari.delta[0];
						}

						await saveState();
						postMessage(source`
							${state.大麻雀 ? '*大麻雀 役満縛り*\n\n' : ''}河${河牌s.slice(0, Math.min(当たり牌Index + 1, 河牌Count - 1)).map(牌ToName).join('・')}${当たり牌Index === 河牌Count - 1 ? ` 摸${牌ToName(河牌s[河牌s.length - 1])}` : ''}
							${当たり牌Index === 河牌Count - 1 ? 'ツモ!!!' : 'ロン!!!'}

							${役s.join('・')}

							${is錯和 ? '錯和 ' : ''}${agari.delta[0]}点
							現在の得点: ${state.大麻雀 ? state.大麻雀Points : state.points}点
						`, {
							手牌: state.手牌.concat([河牌s[当たり牌Index]]),
							王牌: generate王牌(裏ドラ表示牌s),
							王牌Status: 'open',
							mode: 'broadcast',
						});

						state.thread = null;
						await saveState();
						await checkPoints();

						state.deployUnblock();
						state.phase = 'waiting';

						if (state.mode === '四人' && !state.大麻雀) {
							await unlock(message.user, 'mahjong');
							if (役s.includes('七対子')) {
								await unlock(message.user, 'mahjong-七対子');
							}
							if (役s.includes('海底摸月')) {
								await unlock(message.user, 'mahjong-海底摸月');
							}
							if (agari.doraTotal >= 8) {
								await unlock(message.user, 'mahjong-ドラ8');
							}
							if (agari.delta[0] >= 12000) {
								await unlock(message.user, 'mahjong-12000');
							}
							if (agari.delta[0] >= 24000) {
								await unlock(message.user, 'mahjong-24000');
							}
							if (agari.delta[0] >= 36000) {
								await unlock(message.user, 'mahjong-36000');
							}
							if (agari.delta[0] >= 48000) {
								await unlock(message.user, 'mahjong-48000');
							}

							const 待ち牌s = Array(34).fill(0).map((_, index) => (
								String.fromCodePoint(0x1F000 + index)
							)).filter((牌) => {
								const result = calculator.agari(state.手牌.concat([牌]), {isRiichi: false});
								return result.agari.isAgari;
							});
							if (待ち牌s.length === 1 && 待ち牌s[0] === '🀂') {
								await unlock(message.user, 'mahjong-西単騎');
							}
							if (待ち牌s.includes('🀐') && 待ち牌s.includes('🀓') && state.リーチTurn >= 11) {
								await unlock(message.user, 'mahjong-一四索');
							}
						}

						return;
					}

					postMessage(source`
						河${河牌s.slice(0, 河牌Count - 1).map(牌ToName).join('・')} 摸${牌ToName(河牌s[河牌s.length - 1])} 残り${state.remaining自摸}牌
					`, {
						手牌: state.手牌.concat([河牌s[河牌s.length - 1]]),
						王牌: generate王牌(),
					});

					await new Promise((resolve) => {
						setTimeout(resolve, 3000);
					});
				}

				state.deployUnblock();
				state.phase = 'waiting';
				const isTenpai = calculator.tenpai(state.手牌);
				if (isTenpai) {
					if (state.大麻雀) {
						state.大麻雀Points -= 1000;
					} else {
						state.points -= 1000;
					}

					await saveState();
					postMessage(source`
						${state.大麻雀 ? '*大麻雀 役満縛り*\n\n' : ''}流局 供託点 -1000点
						現在の得点: ${state.大麻雀 ? state.大麻雀Points : state.points}点
					`, {
						mode: 'broadcast',
					});
				} else {
					if (state.大麻雀) {
						state.大麻雀Points -= 12000;
					} else {
						state.points -= 12000;
					}

					await saveState();
					postMessage(source`
						${state.大麻雀 ? '*大麻雀 役満縛り*\n\n' : ''}流局 不聴立直 -12000点
						現在の得点: ${state.大麻雀 ? state.大麻雀Points : state.points}点
					`, {
						mode: 'broadcast',
					});
					if (state.mode === '四人' && !state.大麻雀) {
						await unlock(message.user, 'mahjong-不聴立直');
					}
				}

				state.thread = null;
				await saveState();

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
					isVirgin: state.remaining自摸 === (state.大麻雀 ? 20 : 17),
					additionalDora: state.抜きドラCount,
				});

				state.deployUnblock();
				state.phase = 'waiting';

				if (!agari.isAgari) {
					if (state.大麻雀) {
						state.大麻雀Points -= 12000;
					} else {
						state.points -= 12000;
					}
					await saveState();
					postMessage(source`
						${state.大麻雀 ? '*大麻雀 役満縛り*\n\n' : ''}錯和 -12000点
						現在の得点: ${state.大麻雀 ? state.大麻雀Points : state.points}点
					`, {
						mode: 'broadcast',
					});
					state.thread = null;
					await saveState();
					await checkPoints();
					return;
				}

				let is錯和 = false;

				if (state.大麻雀) {
					if (agari.delta[0] < 48000) {
						is錯和 = true;
						agari.delta[0] = -12000;
					}
					state.大麻雀Points += agari.delta[0];
				} else {
					state.points += agari.delta[0];
				}

				await saveState();
				postMessage(source`
					${state.大麻雀 ? '*大麻雀 役満縛り*\n\n' : ''}ツモ!!!

					${役s.join('・')}

					${is錯和 ? '錯和 ' : ''}${agari.delta[0]}点
					現在の得点: ${state.大麻雀 ? state.大麻雀Points : state.points}点
				`, {
					mode: 'broadcast',
				});
				state.thread = null;
				await saveState();
				await checkPoints();
			}
		}

		const getQuiz = ([min待ち牌, max待ち牌], isHardMode) => {
			while (true) {
				const 牌Numbers = Array.from(Array(9).keys()).flatMap((i) => [i + 1, i + 1, i + 1, i + 1]);
				const sampled牌Numbers = sampleSize(牌Numbers, 13);
				const color = sample(['m', 'p', 's']);
				const 牌s = sampled牌Numbers.map((n) => (
					String.fromCodePoint(0x1F000 + calculator.paiIndices.indexOf(`${n}${color}`))
				));
				if (!isHardMode) {
					sort(牌s);
				}
				const 聴牌s = Array.from(new Set(麻雀牌)).filter((牌) => {
					// 5枚使いはNG
					if (牌s.filter((s) => s === 牌).length === 4) {
						return false;
					}
					const {agari} = calculator.agari([...牌s, 牌], {isRiichi: true});
					return agari.isAgari;
				}).map((牌) => (
					calculator.paiIndices[牌.codePointAt(0) - 0x1F000][0]
				));
				const answer = 聴牌s.length === 0 ? 'ノーテン' : Array.from(new Set(聴牌s)).join('');
				if (聴牌s.length >= min待ち牌 && 聴牌s.length <= max待ち牌) {
					return {answer, 牌s, numbers: sampled牌Numbers};
				}
			}
		};

		if (text === 'チンイツクイズ' || text === 'チンイツクイズhard') {
			if (mutex.isLocked()) {
				postMessage('今クイズ中だよ😠', {mode: 'initial'});
				return;
			}

			const isHardMode = text === 'チンイツクイズhard';
			const channel = process.env.CHANNEL_SANDBOX;
			const [min待ち牌, max待ち牌] = [
				[0, 0],
				[1, 1],
				[2, 2],
				[3, 5],
				[3, 5],
				[4, 5],
				[4, 5],
				[5, 9],
				[5, 9],
				[6, 9],
			][random(0, 9)];
			const {牌s, answer} = getQuiz([min待ち牌, max待ち牌], isHardMode);
			const problem = {
				problemMessage: {
					channel,
					text: '待ちは何でしょう？ (回答例: `45` `258 3` `ノーテン`)\n⚠️回答は1人1回までです!',
					attachments: [{
						image_url: await uploadImage(`https://mahjong.hakatashi.com/images/${encodeURIComponent(牌s.join(''))}`),
						fallback: 牌s.join(''),
					}],
				},
				hintMessages: [],
				immediateMessage: {channel, text: '制限時間: 60秒'},
				solvedMessage: {
					channel,
					text: `<@[[!user]]> 正解:tada:\n答えは \`${answer}\` だよ:muscle:`,
					reply_broadcast: true,
				},
				unsolvedMessage: {
					channel,
					text: `もう、しっかりして！\n答えは \`${answer}\` だよ:anger:`,
					reply_broadcast: true,
				},
				answerMessage: {channel, text: `答え: \`${answer}\``},
				correctAnswers: [answer],
			};

			const ateQuiz = new TenpaiAteQuiz(
				{eventClient, webClient: slack},
				problem,
				{username: 'mahjong', icon_emoji: ':mahjong:'},
			);

			const result = await mutex.runExclusive(async () => {
				return ateQuiz.start();
			});

			if (result.state === 'solved') {
				await increment(result.correctAnswerer, 'mahjong-chinitsu-quiz-answer');
				if (isHardMode) {
					await increment(result.correctAnswerer, 'mahjong-chinitsu-quiz-hard-answer');
				}
				if (answer === 'ノーテン') {
					await increment(result.correctAnswerer, 'mahjong-chinitsu-quiz-noten');
				} else {
					await increment(result.correctAnswerer, 'mahjong-chinitsu-quiz-men', answer.length);
					if (answer.length === 1) {
						await increment(result.correctAnswerer, 'mahjong-chinitsu-quiz-1men');
					}
					if (answer.length >= 5) {
						await increment(result.correctAnswerer, 'mahjong-chinitsu-quiz-tamen');
					}
					if (answer.length === 9) {
						await increment(result.correctAnswerer, 'mahjong-chinitsu-quiz-9men');
					}
				}
			}
		}
	});
};
