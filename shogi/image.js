const path = require('path');
const cloudinary = require('cloudinary');
const sharp = require('sharp');
const {default: Color} = require('shogi9.js/lib/Color.js');

const filenameMap = {
	FU: 'fu',
	KY: 'kyo',
	KE: 'kei',
	GI: 'gin',
	KI: 'kin',
	HI: 'hi',
	KA: 'kaku',
	OU: 'ou',
	TO: 'to',
	NY: 'nkyo',
	NK: 'nkei',
	NG: 'ngin',
	RY: 'ryu',
	UM: 'uma',
};

module.exports.upload = async (board) => {
	const imageOptions = {
		raw: {
			width: 570,
			height: 254,
			channels: 4,
		},
	};

	let image = await sharp(path.resolve(__dirname, 'images/board.png'))
		.raw()
		.toBuffer();

	const compositeImages = [];
	for (const y of Array(3).keys()) {
		for (const x of Array(3).keys()) {
			const piece = board.get(x + 1, y + 1);

			if (!piece) {
				continue;
			}

			const filename = `${piece.color === Color.Black ? 'S' : 'G'}${
				filenameMap[piece.kind]
			}.png`;

			compositeImages.push({
				input: path.resolve(__dirname, 'images', filename),
				left: Math.floor(319 - 58.5 * x),
				top: Math.floor(42 + 58.5 * y),
			});
		}
	}

	for (const [color, pieces] of board.hands.entries()) {
		const base = color === Color.Black ? {x: 412, y: 176} : {x: 111, y: 25};

		for (const [pieceIndex, piece] of pieces.entries()) {
			const filename = `${piece.color === Color.Black ? 'S' : 'G'}${
				filenameMap[piece.kind]
			}.png`;
			const x = pieceIndex % 3;
			const y = Math.floor(pieceIndex / 3);
			if (y >= 4) {
				continue;
			}

			compositeImages.push({
				input: path.resolve(__dirname, 'images', filename),
				left: Math.floor(base.x + 45 * x * (color === Color.Black ? 1 : -1)),
				top: Math.floor(base.y - 50 * y * (color === Color.Black ? 1 : -1)),
			});
		}
	}

	image = await sharp(image, imageOptions)
		.composite(compositeImages)
		.jpeg()
		.toBuffer();

	const result = await new Promise((resolve, reject) => {
		cloudinary.v2.uploader.upload_stream({resource_type: 'image'}, (error, data) => {
			if (error) {
				reject(error);
			} else {
				resolve(data);
			}
		}).end(image);
	});

	return result.secure_url;
};
