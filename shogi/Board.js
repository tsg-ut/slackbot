const Grid = require('./Grid.js');
const qs = require('querystring');

const gridList = [
	{piece: null, player: null, promoted: null},
	{piece: '王将', player: 0, promoted: false},
	{piece: '飛車', player: 0, promoted: false},
	{piece: '飛車', player: 0, promoted: true},
	{piece: '角行', player: 0, promoted: false},
	{piece: '角行', player: 0, promoted: true},
	{piece: '金将', player: 0, promoted: false},
	{piece: '銀将', player: 0, promoted: false},
	{piece: '銀将', player: 0, promoted: true},
	{piece: '桂馬', player: 0, promoted: false},
	{piece: '桂馬', player: 0, promoted: true},
	{piece: '香車', player: 0, promoted: false},
	{piece: '香車', player: 0, promoted: true},
	{piece: '歩兵', player: 0, promoted: false},
	{piece: '歩兵', player: 0, promoted: true},
	{piece: '王将', player: 1, promoted: false},
	{piece: '飛車', player: 1, promoted: false},
	{piece: '飛車', player: 1, promoted: true},
	{piece: '角行', player: 1, promoted: false},
	{piece: '角行', player: 1, promoted: true},
	{piece: '金将', player: 1, promoted: false},
	{piece: '銀将', player: 1, promoted: false},
	{piece: '銀将', player: 1, promoted: true},
	{piece: '桂馬', player: 1, promoted: false},
	{piece: '桂馬', player: 1, promoted: true},
	{piece: '香車', player: 1, promoted: false},
	{piece: '香車', player: 1, promoted: true},
	{piece: '歩兵', player: 1, promoted: false},
	{piece: '歩兵', player: 1, promoted: true},
];

const handList = [
	'飛車',
	'角行',
	'金将',
	'銀将',
	'桂馬',
	'香車',
	'歩兵',
];

const handsToAscii = (hands) => {
	const asciiHands = [hands.first, hands.second].map((handList) => (
		Object.entries(handList).map(([piece, count]) => {
			if (count === 0) {
				return '';
			}

			if (count === 1) {
				return Grid.pieceToAscii[piece];
			}

			return `${Grid.pieceToAscii[piece]}${count}`;
		}).join('')
	));

	return `${asciiHands[0].toUpperCase()}${asciiHands[1]}`;
};

class Board {
	constructor(grids, hands) {
		this.grids = grids;
		this.hands = hands;
	}

	getImage() {
		return `http://sfenreader.appspot.com/sfen?${qs.encode({
			sfen: `6${
				this.grids.slice(0, 3).map((grid) => grid.toAscii()).join('')
			}/6${
				this.grids.slice(3, 6).map((grid) => grid.toAscii()).join('')
			}/6${
				this.grids.slice(6, 9).map((grid) => grid.toAscii()).join('')
			}/9/9/9/9/9/9 b ${handsToAscii(this.hands)}`,
		})}`;
	}
}

Board.fromBlob = (blob) => {
	const gridsBlob = [...blob].slice(0, 8).map((byte) => byte.toString(2).padStart(8, '0')).join('');
	const handsBlob = [...blob].slice(8, 12).map((byte) => byte.toString(2).padStart(8, '0')).join('');

	const gridNumbers = gridsBlob.slice(-45).match(/.{1,5}/g).reverse().map((bin) => parseInt(bin, 2));

	const grids = gridNumbers.map((number) => new Grid(gridList[number]));

	const handNumbers = [];
	let offset = handsBlob.length;
	for (const length of [3, 3, 4, 4, 4, 4, 6]) {
		offset -= length;
		handNumbers.push(parseInt(handsBlob.slice(offset, offset + length), 2));
	}

	const hands = {first: {}, second: {}};

	for (const [index, number] of handNumbers.entries()) {
		const maxPieces = [2, 2, 4, 4, 4, 4, 7][index];
		let second = number;
		let first = 0;
		while (second >= maxPieces + 1 - first) {
			second -= maxPieces + 1 - first;
			first++;
		}
		hands.first[handList[index]] = first;
		hands.second[handList[index]] = second;
	}

	return new Board(grids, hands);
};

module.exports = Board;
