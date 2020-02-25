const sharp = require('sharp');
const {default: loadFont} = require('../lib/loadFont.ts');

module.exports = async (text) => {
	const font = await loadFont('Noto Serif JP Bold');
	const fontPath = font.getPath(text, 40, 310, 300);
	const box = fontPath.getBoundingBox();
	const svg = Buffer.from(`<svg width="${box.x2 + 40}" height="400">${fontPath.toSVG()}</svg>`);
	const png = await sharp(svg).png().toBuffer();
	return png;
};
