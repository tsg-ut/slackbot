const assert = require('assert');
const {spawn} = require('child_process');
const fs = require('fs');
const path = require('path');
const {promisify} = require('util');
const BN = require('bn.js');
const {stripIndent, stripIndents} = require('common-tags');
const concat = require('concat-stream');
const {constant, times, flatten, range, shuffle, uniq} = require('lodash');
const MillerRabin = require('miller-rabin');
const prime = require('primes-and-factors');
const {unlock} = require('../achievements');
const {ChannelLimitedBot} = require('../lib/channelLimitedBot.ts');
const {extractMessage} = require('../lib/slackUtils.ts');
const primes = require('./primes.ts');

const cardSet = range(1, 14);
const millerRabin = new MillerRabin();

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
		if (parseInt(numberString[numberString.length - 1]) % 2 === 0) {
			return false;
		}
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
				0,
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
				count - 1,
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

class PrimeBot extends ChannelLimitedBot {
	constructor(slackClients) {
		super(slackClients);

		this.username = 'primebot';
		this.iconEmoji = ':1234:';
		this.wakeWordRegex = /^素数大富豪$/;

		try {
			// eslint-disable-next-line global-require
			const savedState = require('./state.json');
			this.state = {
				phase: savedState.phase,
				challenger: savedState.challenger || null,
				hand: savedState.hand || [],
				stock: savedState.stock || [], // 山札
				pile: savedState.pile || [], // 捨て札
				isDrew: savedState.isDrew || false,
				isDrewOnce: savedState.isDrewOnce || false,
				isPenaltied: savedState.isPenaltied || false,
				isRevolution: savedState.isRevolution || false,
				boardCards: savedState.boardCards || [],
				boardNumber: savedState.boardNumber || null,
				turns: savedState.turns || 0,
				channel: savedState.channel || null,
				gameMessageTs: savedState.gameMessageTs || null,
			};
		} catch (e) {
			this.state = {
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
				channel: null,
				gameMessageTs: null,
			};
		}
	}

	async setState(newState) {
		Object.assign(this.state, newState);

		await promisify(fs.writeFile)(
			path.join(__dirname, 'state.json'),
			JSON.stringify(this.state),
		);
	}

	discard(cards) {
		let newHand = this.state.hand;
		for (const card of cards) {
			newHand = drop(newHand, card);
		}
		return this.setState({
			hand: newHand,
			pile: this.state.pile.concat(cards),
		});
	}

	async draw(count) {
		let newStock = this.state.stock.slice();
		let newPile = this.state.pile.slice();
		let newHand = this.state.hand.slice();

		if (this.state.stock.length < count) {
			newStock.push(...shuffle(newPile));
			newPile = [];
		}

		const drewCards = newStock.slice(0, count);
		newHand = sort(newHand.concat(drewCards));
		newStock = newStock.slice(drewCards.length);

		await this.setState({
			stock: newStock,
			pile: newPile,
			hand: newHand,
		});

		return drewCards;
	}

	async afterDiscard() {
		if (this.state.hand.length === 0) {
			const {turns, challenger, isDrewOnce, isPenaltied, channel, gameMessageTs} = this.state;
			await this.postMessage({
				channel,
				text: stripIndent`
					クリアしました:tada:
					*ターン数* ${turns}
				`,
			});
			await this.setState({
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
				channel: null,
				gameMessageTs: null,
			});
			if (gameMessageTs !== null) {
				await this.deleteProgressMessage(gameMessageTs);
			}
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
	}

	async onWakeWord(message, channel) {
		if (this.state.phase !== 'waiting') {
			if (this.state.boardNumber === null) {
				await this.postMessage({
					channel,
					text: stripIndent`
						現在の状態
						${this.state.isRevolution ? ':hammer_and_wrench:革命中:hammer_and_wrench:' : ''}
						*手札* ${cardsToString(this.state.hand)}
					`,
				});
			} else {
				await this.postMessage({
					channel,
					text: stripIndent`
						現在の状態
						${this.state.isRevolution ? ':hammer_and_wrench:革命中:hammer_and_wrench:' : ''}
						*場数* ${this.state.boardNumber} (${cardsToString(this.state.boardCards)})
						*手札* ${cardsToString(this.state.hand)}
					`,
				});
			}
			return null;
		}

		const deck = shuffle([
			...flatten(times(4, constant(range(1, 14)))),
			'X',
			'X',
		]);
		const hand = deck.slice(0, 11);
		const stock = deck.slice(11);

		await this.setState({
			hand: sort(hand),
			challenger: message.user,
			isRevolution: false,
			isDrew: false,
			isDrewOnce: false,
			isPenaltied: false,
			stock,
			phase: 'playing',
			turns: 0,
			channel,
		});

		const result = await this.postMessage({
			channel,
			text: `*手札* ${cardsToString(this.state.hand)}`,
		});

		await this.setState({gameMessageTs: result.ts});
		unlock(message.user, 'prime');
		return result.ts;
	}

	async onMessageEvent(event) {
		await super.onMessageEvent(event);

		const message = extractMessage(event);

		if (
			message === null ||
			!message.text ||
			message.subtype
		) {
			return;
		}

		if (!this.allowedChannels.includes(message.channel)) {
			return;
		}

		if (!message.user) {
			return;
		}

		const {text, user} = message;

		let matches = null;

		if (text === '素数大富豪') {
			return;
		}

		if (text.match(/^\d+$/)) {
			if (this.state.phase !== 'playing') {
				return;
			}

			if (this.state.challenger !== user) {
				return;
			}

			const number = parseInt(text);
			const numberText = text.replace(/^0+/, '');

			let decomposition = null;

			if (this.state.boardNumber === null) {
				for (const count of range(0, 55)) {
					const match = matchByCards(numberText, [], this.state.hand, count);
					if (match !== null) {
						const [numberMatch] = match;
						decomposition = numberMatch;
						break;
					}
				}
			} else {
				assert(typeof this.state.boardNumber === 'string');

				if (!this.state.isRevolution && parseInt(this.state.boardNumber) >= number) {
					await this.postMessage({
						channel: this.state.channel,
						text: `:warning: 場数 (${
							this.state.boardNumber
						}) 以下の数字を出すことはできません。`,
					});
					return;
				}

				if (this.state.isRevolution && parseInt(this.state.boardNumber) <= number) {
					await this.postMessage({
						channel: this.state.channel,
						text: `:warning: 場数 (${
							this.state.boardNumber
						}) 以上の数字を出すことはできません:hammer_and_wrench:`,
					});
					return;
				}

				const match = matchByCards(
					numberText,
					[],
					this.state.hand,
					this.state.boardCards.length,
				);
				if (match !== null) {
					const [numberMatch] = match;
					decomposition = numberMatch;
				}
			}

			if (decomposition === null) {
				await this.postMessage({
					channel: this.state.channel,
					text: `:warning: ${numberText} は手元のカードから出せません。`,
				});
				return;
			}

			if (number === 57) {
				await this.discard(decomposition);
				await this.setState({
					isDrew: false,
					boardCards: [],
					boardNumber: null,
					turns: this.state.turns + 1,
				});
				await this.postMessage({
					channel: this.state.channel,
					text: stripIndent`
						:boom:グロタンカット！:boom:

						場が流れました。
						*手札* ${cardsToString(this.state.hand)}
					`,
				});
				await unlock(this.state.challenger, 'prime-grothendieck');
				await this.afterDiscard();
				return;
			}

			if (number === 1729) {
				await this.discard(decomposition);
				await this.setState({
					isDrew: false,
					isRevolution: !this.state.isRevolution,
					boardCards: decomposition,
					boardNumber: numberText,
					turns: this.state.turns + 1,
				});
				await this.postMessage({
					channel: this.state.channel,
					text: stripIndent`
						:hammer_and_wrench:ラマヌジャン革命！:hammer_and_wrench:

						${this.state.isRevolution ? '革命状態になりました。' : '革命状態でなくなりました。'}
						*手札* ${cardsToString(this.state.hand)}
					`,
				});
				await unlock(this.state.challenger, 'prime-ramanujan');
				await this.afterDiscard();
				return;
			}

			const frequency = await getFrequency(numberText);

			if (frequency === false || (typeof frequency !== 'boolean' && (frequency.length !== 1 || frequency[0].times !== 1)) || number < 2) {
				const drewCards = await this.draw(decomposition.length);
				await this.setState({
					isDrew: false,
					isPenaltied: true,
					boardCards: [],
					boardNumber: null,
					turns: this.state.turns + 1,
				});
				await this.postMessage({
					channel: this.state.channel,
					text: stripIndent`
						:no_entry_sign: *${numberText}* は素数ではありません!!!
						${frequency === false ? '' : `${numberText} = ${frequencyToString(frequency)}`}

						:warning:ペナルティ +${decomposition.length}枚 (${cardsToString(drewCards)})
						*手札* ${cardsToString(this.state.hand)}
					`,
				});
				return;
			}

			await this.setState({
				isDrew: false,
				boardCards: decomposition,
				boardNumber: numberText,
				turns: this.state.turns + 1,
			});

			await this.discard(decomposition);
			await this.postMessage({
				channel: this.state.channel,
				text: stripIndent`
					*場数* ${this.state.boardNumber} (${cardsToString(this.state.boardCards)})
					*手札* ${cardsToString(this.state.hand)}
				`,
			});
			if (numberText.length >= 3) {
				if (primes.mersenne.includes(numberText)) {
					await unlock(this.state.challenger, 'prime-mersenne');
				}
				if (primes.fermat.includes(numberText)) {
					await unlock(this.state.challenger, 'prime-fermat');
				}
				if (primes.fibonacci.includes(numberText)) {
					await unlock(this.state.challenger, 'prime-fibonacci');
				}
				if (primes.lucas.includes(numberText)) {
					await unlock(this.state.challenger, 'prime-lucas');
				}
				if (primes.wolstenholme.includes(numberText)) {
					await unlock(this.state.challenger, 'prime-wolstenholme');
				}
			}
			await this.afterDiscard();
			return;
		}

		if (
			(matches = text
				.replace(/\s/g, '')
				.match(/^(?<rawNumberText>\d+)=(?<factorsText>(?:\d+(?:\^\d+)?\*)*\d+(?:\^\d+)?)$/))
		) {
			if (this.state.phase !== 'playing') {
				return;
			}

			if (this.state.challenger !== user) {
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
				await this.postMessage({
					channel: this.state.channel,
					text: ':warning: 合成数出しは因数が1つ以上必要です。',
				});
				return;
			}

			if (factorComponents.includes('1')) {
				await this.postMessage({
					channel: this.state.channel,
					text: ':warning: 合成数出しで「1」は使えません。',
				});
				return;
			}

			let decompositions = null;

			if (this.state.boardNumber === null) {
				for (const count of range(0, 55)) {
					const match = matchByCards(
						numberText,
						factorComponents,
						this.state.hand,
						count,
					);
					if (match !== null) {
						decompositions = match;
						break;
					}
				}
			} else {
				assert(typeof this.state.boardNumber === 'string');

				if (!this.state.isRevolution && parseInt(this.state.boardNumber) >= number) {
					await this.postMessage({
						channel: this.state.channel,
						text: `:warning: 場数 (${
							this.state.boardNumber
						}) 以下の数字を出すことはできません。`,
					});
					return;
				}

				if (this.state.isRevolution && parseInt(this.state.boardNumber) <= number) {
					await this.postMessage({
						channel: this.state.channel,
						text: `:warning: 場数 (${
							this.state.boardNumber
						}) 以上の数字を出すことはできません:hammer_and_wrench:`,
					});
					return;
				}

				const match = matchByCards(
					numberText,
					factorComponents,
					this.state.hand,
					this.state.boardCards.length,
				);
				if (match !== null) {
					decompositions = match;
				}
			}

			if (decompositions === null) {
				await this.postMessage({
					channel: this.state.channel,
					text: `:warning: ${numberText} = ${factorsText} は手元のカードから出せません。`,
				});
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
					({mantissa, frequency}) => frequency === false || (typeof frequency !== 'boolean' && (frequency.length !== 1 || frequency[0].times !== 1)) || mantissa < 2,
				);

			if (notPrimeMantissas.length !== 0) {
				const drewCards = await this.draw(decompositionCards.length);
				await this.setState({
					isDrew: false,
					isPenaltied: true,
					boardCards: [],
					boardNumber: null,
					turns: this.state.turns + 1,
				});
				await this.postMessage({
					channel: this.state.channel,
					text: stripIndents`
						:no_entry_sign: *${notPrimeMantissas.map(({mantissa}) => mantissa).join(', ')}* は素数ではありません!!!
						${notPrimeMantissas.map(({mantissa, frequency}) => frequency === false ? '' : `${mantissa} = ${frequencyToString(frequency)}`).join('\n')}

						:warning:ペナルティ +${decompositionCards.length}枚 (${cardsToString(drewCards)})
						*手札* ${cardsToString(this.state.hand)}
					`,
				});
				return;
			}

			const correctCalculation = factors
				.map(({mantissa, exponent}) => new BN(mantissa).pow(new BN(exponent)))
				.reduce((a, b) => a.mul(b))
				.toString();

			if (correctCalculation !== numberText) {
				const drewCards = await this.draw(decompositionCards.length);
				await this.setState({
					isDrew: false,
					isPenaltied: true,
					boardCards: [],
					boardNumber: null,
					turns: this.state.turns + 1,
				});
				await this.postMessage({
					channel: this.state.channel,
					text: stripIndent`
						:no_entry_sign: 素因数分解が正しくありません!!!
						${frequencyToString(factors.map(({mantissa, exponent}) => ({factor: mantissa, times: exponent})))} = ${correctCalculation}

						:warning:ペナルティ +${decompositionCards.length}枚 (${cardsToString(drewCards)})
						*手札* ${cardsToString(this.state.hand)}
					`,
				});
				return;
			}

			await this.setState({
				isDrew: false,
				boardCards: numberDecomposition,
				boardNumber: numberText,
				turns: this.state.turns + 1,
			});

			await this.discard(decompositionCards);
			await this.postMessage({
				channel: this.state.channel,
				text: stripIndent`
					*場数* ${this.state.boardNumber} (${cardsToString(this.state.boardCards)})
					→ *素因数分解* ${frequencyToString(factors.map(({mantissa, exponent}) => ({factor: mantissa, times: exponent})))} (${cardsToString(flatten(factorDecompositions))})
					*手札* ${cardsToString(this.state.hand)}
				`,
			});
			if (decompositionCards.length >= 8) {
				await unlock(this.state.challenger, 'prime-composition-8');
			}
			await this.afterDiscard();
			return;
		}

		if (text === 'ドロー') {
			if (this.state.phase !== 'playing') {
				return;
			}

			if (this.state.challenger !== user) {
				return;
			}

			if (this.state.isDrew) {
				await this.postMessage({
					channel: this.state.channel,
					text: ':warning: ドローは連続1回のみです。',
				});
				return;
			}

			const drewCards = await this.draw(1);
			await this.setState({
				isDrew: true,
				isDrewOnce: true,
			});
			await this.postMessage({
				channel: this.state.channel,
				text: stripIndent`
					ドロー +1枚 (${cardsToString(drewCards)})
					*手札* ${cardsToString(this.state.hand)}
				`,
			});
			return;
		}

		if (text === 'パス') {
			if (this.state.phase !== 'playing') {
				return;
			}

			if (this.state.challenger !== user) {
				return;
			}

			if (this.state.boardNumber === null) {
				await this.postMessage({
					channel: this.state.channel,
					text: ':warning: 場に何も出ていません。',
				});
				return;
			}

			const drewCards = await this.draw(this.state.boardCards.length);
			await this.setState({
				isDrew: false,
				isPenaltied: true,
				boardCards: [],
				boardNumber: null,
				turns: this.state.turns + 1,
			});
			await this.postMessage({
				channel: this.state.channel,
				text: stripIndent`
					パスしました。

					:warning:ペナルティ +${drewCards.length}枚 (${cardsToString(drewCards)})
					*手札* ${cardsToString(this.state.hand)}
				`,
			});
			return;
		}

		if (text === 'ギブアップ') {
			if (this.state.phase !== 'playing') {
				return;
			}

			if (this.state.challenger !== user) {
				return;
			}

			const {channel, gameMessageTs} = this.state;
			await this.postMessage({
				channel,
				text: stripIndent`
					ギブアップしました。
					*ターン数* ${this.state.turns}ターン
				`,
			});
			await this.setState({
				phase: 'waiting',
				challenger: null,
				hand: [],
				stock: [],
				pile: [],
				isDrew: false,
				boardCards: [],
				boardNumber: null,
				turns: 0,
				channel: null,
				gameMessageTs: null,
			});
			if (gameMessageTs !== null) {
				await this.deleteProgressMessage(gameMessageTs);
			}
			return;
		}

		if (text.startsWith('@primebot')) {
			const body = text.replace(/^@primebot/, '').trim();

			if (this.state.phase === 'playing') {
				if (body === 'reset') {
					const {channel: gameChannel, gameMessageTs} = this.state;
					await this.setState({
						phase: 'waiting',
						challenger: null,
						hand: [],
						stock: [],
						pile: [],
						isDrew: false,
						boardCards: [],
						boardNumber: null,
						turns: 0,
						channel: null,
						gameMessageTs: null,
					});
					await this.postMessage({
						channel: gameChannel,
						text: `<@${user}>によってリセットされました :wave:`,
					});
					if (gameMessageTs !== null) {
						await this.deleteProgressMessage(gameMessageTs);
					}
					return;
				}

				await this.postMessage({
					channel: this.state.channel,
					text: 'カンニング禁止! :imp:',
				});
				return;
			}

			if (!body.match(/^\d+$/)) {
				await this.postMessage({
					channel: message.channel,
					text: ':ha:',
				});
				return;
			}

			const frequency = await getFrequency(body);

			if (frequency === true) {
				await this.postMessage({
					channel: message.channel,
					text: `*${body}* は素数です!`,
				});
				return;
			}

			if (frequency === false) {
				await this.postMessage({
					channel: message.channel,
					text: `*${body}* は合成数です!`,
				});
				return;
			}

			const isPrime =
				frequency.length === 1 && frequency[0].times === 1 && parseInt(body) >= 2;

			if (isPrime) {
				await this.postMessage({
					channel: message.channel,
					text: `*${body}* は素数です!`,
				});
				return;
			}

			await this.postMessage({
				channel: message.channel,
				text: `*${body}* = ${parseInt(body) === 1 ? '1' : frequencyToString(frequency)}`,
			});
		}
	}
}

module.exports = (slackClients) => new PrimeBot(slackClients);
