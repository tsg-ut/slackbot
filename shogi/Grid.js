const pieceToAscii = {
	王将: 'k',
	飛車: 'r',
	角行: 'b',
	金将: 'g',
	銀将: 's',
	桂馬: 'n',
	香車: 'l',
	歩兵: 'p',
};

class Grid {
	constructor({piece, player, promoted}) {
		this.piece = piece;
		this.player = player;
		this.promoted = promoted;
	}

	toAscii() {
		if (this.piece === null) {
			return '1';
		}

		const ascii = pieceToAscii[this.piece];

		if (this.player === 1) {
			return `${this.promoted ? '+' : ''}${ascii}`;
		}

		return `${this.promoted ? '+' : ''}${ascii.toUpperCase()}`;
	}
}

module.exports = Grid;
module.exports.pieceToAscii = pieceToAscii;
