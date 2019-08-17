const path = require('path');
const fs = require('fs');
const assert = require('assert');
const {promisify} = require('util');
const {constant, times, flatten, range, shuffle, uniq} = require('lodash');
const {stripIndent, stripIndents} = require('common-tags');
const prime = require('primes-and-factors');
const {spawn} = require('child_process');
const concat = require('concat-stream');
const MillerRabin = require('miller-rabin');
const BN = require('bn.js');
const {unlock} = require('../achievements');
const primes = require('./primes.ts');

const cardSet = range(1, 14);
const millerRabin = new MillerRabin();

const state = (() => {
	try {
		// eslint-disable-next-line global-require
		const savedState = require('./state.json');
		return {
			phase: savedState.phase,
			challenger: savedState.challenger || null,
			hand: savedState.hand || [],
			stock: savedState.stock || [],
			pile: savedState.pile || [],
			isDrew: savedState.isDrew || false,
			isDrewOnce: savedState.isDrewOnce || false,
			isPenaltied: savedState.isPenaltied || false,
			isRevolution: savedState.isRevolution || false,
			boardCards: savedState.boardCards || [],
			boardNumber: savedState.boardNumber || null,
			turns: savedState.turns || 0,
		};
	} catch (e) {
		return {
			phase: 'waiting',
			challenger: null,
			hand: [],
			stock: [], // 山札
			pile: [], // 捨て札
			isDrew: false,
			isDrewOnce: false,
			isPenaltied: false,
			isRevolution: false,
			boardCards: [],
			boardNumber: null,
			turns: 0,
		};
	}
})();

const sort = (cards) => cards.slice().sort((a, b) => {
	if (a === 'X') {
		return 1;
	}

	if (b === 'X') {
		return -1;
	}

	return a - b;
});

const cardsToString = (cards) => {
	if (cards.length === 0) {
		return 'なし';
	}

	return cards
		.map((card) => {
			if (typeof card === 'number') {
				return card.toString();
			}

			return card;
		})
		.join(' / ');
};

const toSuperscript = (number) => number
	.toString()
	.split('')
	.map((digit) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[digit])
	.join('');

const getFrequency = async (numberString) => {
	assert(numberString.match(/^\d+$/));

	if (parseInt(numberString) < Number.MAX_SAFE_INTEGER) {
		return prime.getFrequency(parseInt(numberString));
	}

	if (numberString.length <= 35) {
		const command = spawn('factor', [numberString]);
		const result = await new Promise((resolve) => {
			command.stdout.pipe(concat((stdout) => resolve(stdout)));
		});
		const factors = (result.toString().split(':')[1] || '').trim().split(' ');
		const frequencies = Array.from(new Set(factors)).sort((a, b) => parseInt(a) - parseInt(b)).map((factor) => ({
			factor,
			times: factors.filter((f) => f === factor).length,
		}));
		return frequencies;
	}

	if (numberString.length <= 200) {
		return millerRabin.test(new BN(numberString));
	}

	return false;
};

const frequencyToString = (frequency) => frequency
	.map(({factor, times: factorTimes}) => {
		if (factorTimes === 1) {
			return factor;
		}

		return `${factor}${toSuperscript(factorTimes)}`;
	})
	.join(' × ');

// ([1, 2, 3, 3, 5], 3) => [1, 2, 3, 5]
const drop = (array, value) => {
	const clone = array.slice();
	const index = clone.indexOf(value);
	if (value !== -1) {
		clone.splice(index, 1);
	}
	return clone;
};

// ('11582', ['27'], [1, 1, 2, 2, 3, 6, 7, 11, 'X', 'X'], 4) => [[11, 'X', 'X', 2], [[2, 7]]]
// eslint-disable-next-line max-params
const matchByCards = (number, factors, cards, count) => {
	if (number === '' && count !== 0) {
		return null;
	}

	if (number !== '' && count === 0) {
		return null;
	}

	if (number === '' && factors.every((factor) => factor === '')) {
		return [[], factors.map(() => [])];
	}

	const candidates = uniq(cards);
	const complements = cardSet.filter((card) => !candidates.includes(card));

	if (candidates.includes('X')) {
		candidates.push(...complements, 0);
	}

	if (candidates.length === 0) {
		return null;
	}

	for (const card of candidates) {
		const cardString = card.toString();

		if (number === '') {
			assert(count === 0);

			const factorIndex = factors.findIndex((factor) => factor !== '');
			assert(factorIndex !== -1);

			if (!factors[factorIndex].startsWith(cardString)) {
				continue;
			}

			const remnant = factors[factorIndex].slice(cardString.length);
			const nextFactors = factors.slice();
			nextFactors[factorIndex] = remnant;
			const match = matchByCards(
				'',
				nextFactors,
				drop(cards, cards.includes(card) ? card : 'X'),
				0
			);

			if (match !== null) {
				const [numberMatch, factorMatches] = match;
				assert(numberMatch.length === 0);

				factorMatches[factorIndex] = factorMatches[factorIndex].slice();

				if (cards.includes(card)) {
					factorMatches[factorIndex].unshift(card);
				} else {
					factorMatches[factorIndex].unshift('X');
				}

				return [[], factorMatches];
			}
		} else {
			if (!number.startsWith(cardString)) {
				continue;
			}

			const remnant = number.slice(cardString.length);
			const match = matchByCards(
				remnant,
				factors,
				drop(cards, cards.includes(card) ? card : 'X'),
				count - 1
			);

			if (match !== null) {
				const [numberMatch, factorMatches] = match;

				if (cards.includes(card)) {
					return [[card, ...numberMatch], factorMatches];
				}
				return [['X', ...numberMatch], factorMatches];
			}
		}
	}

	return null;
};

const setState = async (newState) => {
	Object.assign(state, newState);

	const savedState = {};
	for (const [key, value] of Object.entries(state)) {
		savedState[key] = value;
	}

	await promisify(fs.writeFile)(
		path.join(__dirname, 'state.json'),
		JSON.stringify(savedState)
	);
};

const discard = (cards) => {
	let newHand = state.hand;
	for (const card of cards) {
		newHand = drop(newHand, card);
	}
	return setState({
		hand: newHand,
		pile: state.pile.concat(cards),
	});
};

const draw = async (count) => {
	let newStock = state.stock.slice();
	let newPile = state.pile.slice();
	let newHand = state.hand.slice();

	if (state.stock.length < count) {
		newStock.push(...shuffle(newPile));
		newPile = [];
	}

	const drewCards = newStock.slice(0, count);
	newHand = sort(newHand.concat(drewCards));
	newStock = newStock.slice(drewCards.length);

	await setState({
		stock: newStock,
		pile: newPile,
		hand: newHand,
	});

	return drewCards;
};

module.exports = ({rtmClient: rtm, webClient: slack}) => {
	const postMessage = (text, attachments, options) => slack.chat.postMessage({
		channel: process.env.CHANNEL_SANDBOX,
		text,
		username: 'primebot',
		// eslint-disable-next-line camelcase
		icon_emoji: ':1234:',
		...(attachments ? {attachments} : {}),
		...(options ? options : {}),
	});

	const afterDiscard = async () => {
		if (state.hand.length === 0) {
			const {turns, challenger, isDrewOnce, isPenaltied} = state;
			await postMessage(stripIndent`
				クリアしました:tada:
				*ターン数* ${state.turns}
			`);
			await setState({
				phase: 'waiting',
				challenger: null,
				hand: [],
				stock: [],
				pile: [],
				isDrew: false,
				isDrewOnce: false,
				isPenaltied: false,
				boardCards: [],
				boardNumber: null,
				turns: 0,
			});
			unlock(challenger, 'prime-clear');
			if (turns <= 4) {
				unlock(challenger, 'prime-fast-clear');
				if (!isDrewOnce) {
					unlock(challenger, 'prime-fast-clear-no-draw');
				}
				if (!isDrewOnce && !isPenaltied) {
					unlock(challenger, 'prime-fast-clear-no-draw-no-penalty');
				}
			}
		}
	};

	rtm.on('message', async (message) => {
		if (message.channel !== process.env.CHANNEL_SANDBOX) {
			return;
		}

		if (!message.text) {
			return;
		}

		if (message.username === 'prime') {
			return;
		}

		if (!message.user) {
			return;
		}

		const {text, user} = message;

		let matches = null;

		if (text === '素数大富豪') {
			if (state.phase !== 'waiting') {
				if (state.boardNumber === null) {
					await postMessage(stripIndent`
						現在の状態
						${state.isRevolution ? ':hammer_and_wrench:革命中:hammer_and_wrench:' : ''}
						*手札* ${cardsToString(state.hand)}
					`);
				} else {
					await postMessage(stripIndent`
						現在の状態
						${state.isRevolution ? ':hammer_and_wrench:革命中:hammer_and_wrench:' : ''}
						*場数* ${state.boardNumber} (${cardsToString(state.boardCards)})
						*手札* ${cardsToString(state.hand)}
					`);
				}
				return;
			}

			const deck = shuffle([
				...flatten(times(4, constant(range(1, 14)))),
				'X',
				'X',
			]);
			const hand = deck.slice(0, 11);
			const stock = deck.slice(11);

			await setState({
				hand: sort(hand),
				challenger: user,
				isRevolution: false,
				isDrew: false,
				isDrewOnce: false,
				isPenaltied: false,
				stock,
				phase: 'playing',
				turns: 0,
			});

			await postMessage(`*手札* ${cardsToString(state.hand)}`);
			unlock(user, 'prime');
			return;
		}

		if (text.match(/^\d+$/)) {
			if (state.phase !== 'playing') {
				return;
			}

			if (state.challenger !== user) {
				return;
			}

			const number = parseInt(text);
			const numberText = text.replace(/^0+/, '');

			let decomposition = null;

			if (state.boardNumber === null) {
				for (const count of range(0, 55)) {
					const match = matchByCards(numberText, [], state.hand, count);
					if (match !== null) {
						const [numberMatch] = match;
						decomposition = numberMatch;
						break;
					}
				}
			} else {
				assert(typeof state.boardNumber === 'string');

				if (!state.isRevolution && parseInt(state.boardNumber) >= number) {
					await postMessage(
						`:warning: 場数 (${
							state.boardNumber
						}) 以下の数字を出すことはできません。`
					);
					return;
				}

				if (state.isRevolution && parseInt(state.boardNumber) <= number) {
					await postMessage(
						`:warning: 場数 (${
							state.boardNumber
						}) 以上の数字を出すことはできません:hammer_and_wrench:`
					);
					return;
				}

				const match = matchByCards(
					numberText,
					[],
					state.hand,
					state.boardCards.length
				);
				if (match !== null) {
					const [numberMatch] = match;
					decomposition = numberMatch;
				}
			}

			if (decomposition === null) {
				await postMessage(
					`:warning: ${numberText} は手元のカードから出せません。`
				);
				return;
			}

			if (number === 57) {
				await discard(decomposition);
				await setState({
					isDrew: false,
					boardCards: [],
					boardNumber: null,
					turns: state.turns + 1,
				});
				await postMessage(stripIndent`
					:boom:グロタンカット！:boom:

					場が流れました。
					*手札* ${cardsToString(state.hand)}
				`);
				await unlock(state.challenger, 'prime-grothendieck');
				await afterDiscard();
				return;
			}

			if (number === 1729) {
				await discard(decomposition);
				await setState({
					isDrew: false,
					isRevolution: !state.isRevolution,
					boardCards: decomposition,
					boardNumber: numberText,
					turns: state.turns + 1,
				});
				await postMessage(stripIndent`
					:hammer_and_wrench:ラマヌジャン革命！:hammer_and_wrench:

					${state.isRevolution ? '革命状態になりました。' : '革命状態でなくなりました。'}
					*手札* ${cardsToString(state.hand)}
				`);
				await unlock(state.challenger, 'prime-ramanujan');
				await afterDiscard();
				return;
			}

			const frequency = await getFrequency(numberText);

			if (frequency === false || (typeof frequency !== 'boolean' && (frequency.length !== 1 || frequency[0].times !== 1)) || number < 2) {
				const drewCards = await draw(decomposition.length);
				await setState({
					isDrew: false,
					isPenaltied: true,
					boardCards: [],
					boardNumber: null,
					turns: state.turns + 1,
				});
				await postMessage(stripIndent`
					:no_entry_sign: *${numberText}* は素数ではありません!!!
					${frequency === false ? '' : `${numberText} = ${frequencyToString(frequency)}`}

					:warning:ペナルティ +${decomposition.length}枚 (${cardsToString(drewCards)})
					*手札* ${cardsToString(state.hand)}
				`);
				return;
			}

			await setState({
				isDrew: false,
				boardCards: decomposition,
				boardNumber: numberText,
				turns: state.turns + 1,
			});

			await discard(decomposition);
			await postMessage(stripIndent`
				*場数* ${state.boardNumber} (${cardsToString(state.boardCards)})
				*手札* ${cardsToString(state.hand)}
			`);
			if (numberText.length >= 3) {
				if (primes.mersenne.includes(numberText)) {
					await unlock(state.challenger, 'prime-mersenne');
				}
				if (primes.fermat.includes(numberText)) {
					await unlock(state.challenger, 'prime-fermat');
				}
				if (primes.fibonacci.includes(numberText)) {
					await unlock(state.challenger, 'prime-fibonacci');
				}
				if (primes.lucas.includes(numberText)) {
					await unlock(state.challenger, 'prime-lucas');
				}
				if (primes.wolstenholme.includes(numberText)) {
					await unlock(state.challenger, 'prime-wolstenholme');
				}
			}
			await afterDiscard();
			return;
		}

		if (
			(matches = text
				.replace(/\s/g, '')
				.match(/^(?<rawNumberText>\d+)=(?<factorsText>(?:\d+(?:\^\d+)?\*)*\d+(?:\^\d+)?)$/))
		) {
			if (state.phase !== 'playing') {
				return;
			}

			if (state.challenger !== user) {
				return;
			}

			const {rawNumberText, factorsText} = matches.groups;
			const factorComponents = factorsText
				.split(/[\^*]/)
				.map((component) => component.replace(/[^\d]/g, '').replace(/^0+/, ''));
			const factors = factorsText.split('*').map((factorText) => {
				const [mantissa, exponent = '1'] = factorText.split('^');
				return {
					mantissa: mantissa.replace(/[^\d]/g, '').replace(/^0+/, ''),
					exponent: parseInt(exponent),
				};
			});
			const number = parseInt(rawNumberText);
			const numberText = rawNumberText.replace(/^0+/, '');

			if (factors.length === 1 && factors[0].exponent === 1) {
				await postMessage(':warning: 合成数出しは因数が1つ以上必要です。');
				return;
			}

			if (factorComponents.includes('1')) {
				await postMessage(':warning: 合成数出しで「1」は使えません。');
				return;
			}

			let decompositions = null;

			if (state.boardNumber === null) {
				for (const count of range(0, 55)) {
					const match = matchByCards(
						numberText,
						factorComponents,
						state.hand,
						count
					);
					if (match !== null) {
						decompositions = match;
						break;
					}
				}
			} else {
				assert(typeof state.boardNumber === 'string');

				if (!state.isRevolution && parseInt(state.boardNumber) >= number) {
					await postMessage(
						`:warning: 場数 (${
							state.boardNumber
						}) 以下の数字を出すことはできません。`
					);
					return;
				}

				if (state.isRevolution && parseInt(state.boardNumber) <= number) {
					await postMessage(
						`:warning: 場数 (${
							state.boardNumber
						}) 以上の数字を出すことはできません:hammer_and_wrench:`
					);
					return;
				}

				const match = matchByCards(
					numberText,
					factorComponents,
					state.hand,
					state.boardCards.length
				);
				if (match !== null) {
					decompositions = match;
				}
			}

			if (decompositions === null) {
				await postMessage(
					`:warning: ${numberText} = ${factorsText} は手元のカードから出せません。`
				);
				return;
			}

			const [numberDecomposition, factorDecompositions] = decompositions;
			const decompositionCards = flatten([
				numberDecomposition,
				...factorDecompositions,
			]);

			const notPrimeMantissas = (await Promise.all(factors
				.map(async ({mantissa}) => {
					const frequency = await getFrequency(mantissa);
					return {mantissa, frequency};
				})))
				.filter(
					({mantissa, frequency}) => frequency === false || (typeof frequency !== 'boolean' && (frequency.length !== 1 || frequency[0].times !== 1)) || mantissa < 2
				);

			if (notPrimeMantissas.length !== 0) {
				const drewCards = await draw(decompositionCards.length);
				await setState({
					isDrew: false,
					isPenaltied: true,
					boardCards: [],
					boardNumber: null,
					turns: state.turns + 1,
				});
				await postMessage(stripIndents`
					:no_entry_sign: *${notPrimeMantissas.map(({mantissa}) => mantissa).join(', ')}* は素数ではありません!!!
					${notPrimeMantissas.map(({mantissa, frequency}) => frequency === false ? '' : `${mantissa} = ${frequencyToString(frequency)}`).join('\n')}

					:warning:ペナルティ +${decompositionCards.length}枚 (${cardsToString(drewCards)})
					*手札* ${cardsToString(state.hand)}
				`);
				return;
			}

			const correctCalculation = factors
				.map(({mantissa, exponent}) => new BN(mantissa).pow(new BN(exponent)))
				.reduce((a, b) => a.mul(b))
				.toString();

			if (correctCalculation !== numberText) {
				const drewCards = await draw(decompositionCards.length);
				await setState({
					isDrew: false,
					isPenaltied: true,
					boardCards: [],
					boardNumber: null,
					turns: state.turns + 1,
				});
				await postMessage(stripIndent`
					:no_entry_sign: 素因数分解が正しくありません!!!
					${frequencyToString(factors.map(({mantissa, exponent}) => ({factor: mantissa, times: exponent})))} = ${correctCalculation}

					:warning:ペナルティ +${decompositionCards.length}枚 (${cardsToString(drewCards)})
					*手札* ${cardsToString(state.hand)}
				`);
				return;
			}

			await setState({
				isDrew: false,
				boardCards: numberDecomposition,
				boardNumber: numberText,
				turns: state.turns + 1,
			});

			await discard(decompositionCards);
			await postMessage(stripIndent`
				*場数* ${state.boardNumber} (${cardsToString(state.boardCards)})
				→ *素因数分解* ${frequencyToString(factors.map(({mantissa, exponent}) => ({factor: mantissa, times: exponent})))} (${cardsToString(flatten(factorDecompositions))})
				*手札* ${cardsToString(state.hand)}
			`);
			if (decompositionCards.length >= 8) {
				await unlock(state.challenger, 'prime-composition-8');
			}
			await afterDiscard();
			return;
		}

		if (text === 'ドロー') {
			if (state.phase !== 'playing') {
				return;
			}

			if (state.challenger !== user) {
				return;
			}

			if (state.isDrew) {
				await postMessage(':warning: ドローは連続1回のみです。');
				return;
			}

			const drewCards = await draw(1);
			await setState({
				isDrew: true,
				isDrewOnce: true,
			});
			await postMessage(stripIndent`
				ドロー +1枚 (${cardsToString(drewCards)})
				*手札* ${cardsToString(state.hand)}
			`);
			return;
		}

		if (text === 'パス') {
			if (state.phase !== 'playing') {
				return;
			}

			if (state.challenger !== user) {
				return;
			}

			if (state.boardNumber === null) {
				await postMessage(':warning: 場に何も出ていません。');
				return;
			}

			const drewCards = await draw(state.boardCards.length);
			await setState({
				isDrew: false,
				isPenaltied: true,
				boardCards: [],
				boardNumber: null,
				turns: state.turns + 1,
			});
			await postMessage(stripIndent`
				パスしました。

				:warning:ペナルティ +${drewCards.length}枚 (${cardsToString(drewCards)})
				*手札* ${cardsToString(state.hand)}
			`);
			return;
		}

		if (text === 'ギブアップ') {
			if (state.phase !== 'playing') {
				return;
			}

			if (state.challenger !== user) {
				return;
			}

			await postMessage(stripIndent`
				ギブアップしました。
				*ターン数* ${state.turns}ターン
			`);
			await setState({
				phase: 'waiting',
				challenger: null,
				hand: [],
				stock: [],
				pile: [],
				isDrew: false,
				boardCards: [],
				boardNumber: null,
				turns: 0,
			});
			return;
		}

		if (text.startsWith('@primebot')) {
			const body = text.replace(/^@primebot/, '').trim();

			if (state.phase === 'playing') {
				if (body === 'reset') {
					await setState({
						phase: 'waiting',
						challenger: null,
						hand: [],
						stock: [],
						pile: [],
						isDrew: false,
						boardCards: [],
						boardNumber: null,
						turns: 0,
					});
					await postMessage(`<@${user}>によってリセットされました :wave:`);
					return;
				}

				await postMessage('カンニング禁止! :imp:');
				return;
			}

			if (!body.match(/^\d+$/)) {
				await postMessage(':ha:');
				return;
			}

			const frequency = await getFrequency(body);

			if (frequency === true) {
				await postMessage(`*${body}* は素数です!`);
				return;
			}

			if (frequency === false) {
				await postMessage(`*${body}* は合成数です!`);
				return;
			}

			const isPrime =
				frequency.length === 1 && frequency[0].times === 1 && parseInt(body) >= 2;

			if (isPrime) {
				await postMessage(`*${body}* は素数です!`);
				return;
			}

			await postMessage(
				`*${body}* = ${parseInt(body) === 1 ? '1' : frequencyToString(frequency)}`
			);
		}
	});
};
