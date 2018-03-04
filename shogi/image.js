const axios = require('axios');
const concat = require("concat-stream");
const sharp = require('sharp');
const FormData = require('form-data');
const {default: Color} = require('shogi9.js/lib/Color.js');
const path = require('path');
const qs = require('querystring');

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

	let image = await sharp(path.resolve(__dirname, 'images/board.png')).raw().toBuffer();

	for (const y of Array(3).keys()) {
		for (const x of Array(3).keys()) {
			const piece = board.get(x + 1, y + 1);

			if (!piece) {
				continue;
			}

			const filename = `${piece.color === Color.Black ? 'S' : 'G'}${filenameMap[piece.kind]}.png`;

			image = await sharp(image, imageOptions).overlayWith(path.resolve(__dirname, 'images', filename), {
				left: Math.floor(319 - 58.5 * x),
				top: Math.floor(42 + 58.5 * y),
			}).raw().toBuffer();
		}
	}

	for (const [color, pieces] of board.hands.entries()) {
		const base = color === Color.Black ? {x: 412, y: 176} : {x: 111, y: 25};

		for (const [pieceIndex, piece] of pieces.entries()) {
			const filename = `${piece.color === Color.Black ? 'S' : 'G'}${filenameMap[piece.kind]}.png`;
			const x = pieceIndex % 3;
			const y = Math.floor(pieceIndex / 3);
			if (y >= 4) {
				continue;
			}

			image = await sharp(image, imageOptions).overlayWith(path.resolve(__dirname, 'images', filename), {
				left: Math.floor(base.x + 45 * x * (color === Color.Black ? 1 : -1)),
				top: Math.floor(base.y - 50 * y * (color === Color.Black ? 1 : -1)),
			}).raw().toBuffer();
		}
	}

	image = await sharp(image, imageOptions).jpeg().toBuffer();

	const form = new FormData();
	form.append('key', process.env.IMAGEBIN_KEY);
	form.append('file', image, {
		filename: 'image.jpeg',
		contentType: 'image/jpeg',
	});

	const data = await new Promise((resolve) => {
		form.pipe(concat({encoding: 'buffer'}, async (data) => {
			resolve(await axios.post('https://imagebin.ca/upload.php', Buffer.from(data, 'binary'), {
				headers: form.getHeaders()
			}));
		}));
	});

	const payload = qs.parse(data.data, '\n', ':');

	return payload.url;
};
