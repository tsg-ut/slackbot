const qs = require('querystring');
const {default: Shogi} = require('shogi9.js');
const {default: Color} = require('shogi9.js/lib/Color.js');

const gridList = [
	{},
	{kind: 'OU', color: Color.Black},
	{kind: 'HI', color: Color.Black},
	{kind: 'RY', color: Color.Black},
	{kind: 'KA', color: Color.Black},
	{kind: 'UM', color: Color.Black},
	{kind: 'KI', color: Color.Black},
	{kind: 'GI', color: Color.Black},
	{kind: 'NG', color: Color.Black},
	{kind: 'KE', color: Color.Black},
	{kind: 'NK', color: Color.Black},
	{kind: 'KY', color: Color.Black},
	{kind: 'NK', color: Color.Black},
	{kind: 'FU', color: Color.Black},
	{kind: 'TO', color: Color.Black},
	{kind: 'OU', color: Color.White},
	{kind: 'HI', color: Color.White},
	{kind: 'RY', color: Color.White},
	{kind: 'KA', color: Color.White},
	{kind: 'UM', color: Color.White},
	{kind: 'KI', color: Color.White},
	{kind: 'GI', color: Color.White},
	{kind: 'NG', color: Color.White},
	{kind: 'KE', color: Color.White},
	{kind: 'NK', color: Color.White},
	{kind: 'KY', color: Color.White},
	{kind: 'NK', color: Color.White},
	{kind: 'FU', color: Color.White},
	{kind: 'TO', color: Color.White},
];

const handList = [
	'HI',
	'KA',
	'KI',
	'GI',
	'KE',
	'KY',
	'FU',
];

module.exports.charToPiece = (char) => ({
	歩: 'FU',
	香: 'KY',
	桂: 'KE',
	銀: 'GI',
	金: 'KI',
	飛: 'HI',
	角: 'KA',
	玉: 'OU',
	と: 'TO',
	成香: 'NY',
	成桂: 'NK',
	成銀: 'NG',
	龍: 'RY',
	馬: 'UM',
}[char]);

module.exports.deserialize = (blob) => {
	const gridsBlob = [...blob].slice(0, 8).map((byte) => byte.toString(2).padStart(8, '0')).join('');
	const handsBlob = [...blob].slice(8, 12).map((byte) => byte.toString(2).padStart(8, '0')).join('');

	const gridNumbers = gridsBlob.slice(-45).match(/.{1,5}/g).reverse().map((bin) => parseInt(bin, 2));

	const grids = gridNumbers.map((number) => gridList[number]);

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

	return new Shogi({
		preset: 'OTHER',
		data: {
			color: Color.Black,
			board: [
				[grids[2], grids[5], grids[8]],
				[grids[1], grids[4], grids[7]],
				[grids[0], grids[3], grids[6]],
			],
			hands: [hands.first, hands.second],
		},
	});
};

module.exports.getTransitions = (board) => {
	const transitions = [];

	for (const y of Array(3).keys()) {
		for (const x of Array(3).keys()) {
			const piece = board.get(x + 1, y + 1);

			if (!piece || piece.color !== Color.White) {
				continue;
			}

			transitions.push(...board.getMovesFrom(x + 1, y + 1));
		}
	}

	transitions.push(...board.getDropsBy(Color.White));
};

module.exports.boardToImage = (board) => {
	const components = board.toSFENString().split(/[ /]/);
	return `http://sfenreader.appspot.com/sfen?${qs.encode({
		sfen: `6${
			components[0]
		}/6${
			components[1]
		}/6${
			components[2]
		}/9/9/9/9/9/9 ${components.slice(3).join(' ')}`,
		sname: '@hakatashi',
		gname: '9マスしょうぎ名人',
	})}`;
};
