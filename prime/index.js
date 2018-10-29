const path = require('path');
const fs = require('fs');
const assert = require('assert');
const {promisify} = require('util');
const {constant, times, flatten, range, shuffle, uniq} = require('lodash');
const {stripIndent} = require('common-tags');

const cardSet = range(1, 14);

const state = (() => {
	try {
		// eslint-disable-next-line global-require
		const savedState = require('./state.json');
		return {
			phase: savedState.phase,
			hand: savedState.hand || [],
			stock: savedState.stock || [],
			pile: savedState.pile || [],
			boardCards: savedState.boardCards || [],
			boardNumber: savedState.boardNumber || null,
		};
	} catch (e) {
		return {
			phase: 'waiting',
			hand: [],
			stock: [], // 山札
			pile: [], // 捨て札
			boardCards: [],
			boardNumber: null,
		};
	}
})();

const sort = (cards) => (
	cards.slice().sort((a, b) => {
		if (a === 'X') {
			return 1;
		}

		if (b === 'X') {
			return -1;
		}

		return a - b;
	})
);

const cardsToString = (cards) => {
	if (cards.length === 0) {
		return 'なし';
	}

	return cards.map((card) => {
		if (typeof card === 'number') {
			return card.toString();
		}

		return card;
	}).join(' / ');
};

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
		candidates.push(...complements);
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
			const match = matchByCards('', nextFactors, drop(cards, cards.includes(card) ? card : 'X'), 0);

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
			const match = matchByCards(remnant, factors, drop(cards, cards.includes(card) ? card : 'X'), count - 1);

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

	await promisify(fs.writeFile)(path.join(__dirname, 'state.json'), JSON.stringify(savedState));
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

module.exports = ({rtmClient: rtm, webClient: slack}) => {
	const postMessage = (text, attachments, options) => (
		slack.chat.postMessage({
			channel: process.env.CHANNEL_SANDBOX,
			text,
			username: 'primebot',
			// eslint-disable-next-line camelcase
			icon_emoji: ':1234:',
			...(attachments ? {attachments} : {}),
			...(options ? options : {}),
		})
	);

	const perdon = () => postMessage(':ha:');

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

		const {text} = message;

		if (text === '素数大富豪') {
			if (state.phase !== 'waiting') {
				await perdon();
				return;
			}

			const deck = shuffle([...flatten(times(4, constant(range(1, 14)))), 'X', 'X']);
			const hand = deck.slice(0, 11);
			const stock = deck.slice(11);

			await setState({
				hand: sort(hand),
				stock,
				phase: 'playing',
			});

			await postMessage(`手札: ${cardsToString(state.hand)}`);
			return;
		}

		if (text.match(/^\d+$/)) {
			if (state.phase !== 'playing') {
				return;
			}

			const number = parseInt(text);
			const numberText = number.toString();

			if (state.boardNumber === null) {
				let decomposition = null;

				for (const count of range(13, 0)) {
					const match = matchByCards(numberText, [], state.hand, count);
					if (match !== null) {
						const [numberMatch] = match;
						decomposition = numberMatch;
					}
				}

				if (decomposition === null) {
					await postMessage(`:warning: ${numberText} は出せません`);
					return;
				}

				await discard(decomposition);
				await postMessage(stripIndent`
					場数: ${number} (${cardsToString(decomposition)})
					手札: ${cardsToString(state.hand)}
				`);
			}
		}
	});
};
