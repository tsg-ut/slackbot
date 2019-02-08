const opentype = require('opentype.js');
const sharp = require('sharp');
const download = require('download');
const path = require('path');
const fs = require('fs');

const loadFont = async () => {
	const fontPath = path.resolve(__dirname, 'NotoSerifCJKjp-Bold.otf');

	const fontExists = await new Promise((resolve) => {
		fs.access(fontPath, fs.constants.F_OK, (error) => {
			resolve(!error);
		});
	});

	if (!fontExists) {
		await download('https://github.com/googlei18n/noto-cjk/raw/master/NotoSerifCJKjp-Bold.otf', __dirname, {
			filename: 'NotoSerifCJKjp-Bold.otf',
		});
	}

	const font = await new Promise((resolve, reject) => {
		opentype.load(fontPath, (error, f) => {
			if (error) {
				reject(error);
			} else {
				resolve(f);
			}
		});
	});

	return font;
};

module.exports = async (text) => {
	const font = await loadFont();
	const fontPath = font.getPath(text, 40, 310, 300);
	const box = fontPath.getBoundingBox();
	const svg = Buffer.from(`<svg width="${box.x2 + 40}" height="400">${fontPath.toSVG()}</svg>`);
	const png = await sharp(svg).png().toBuffer();
	return png;
};
