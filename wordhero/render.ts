// @ts-ignore
import sharp from 'sharp';
import loadFont from '../lib/loadFont';

const render = async (board: string[]) => {
	const font = await loadFont();
	const fontPath = board.map((letter, index) => (
		font.getPath(
			letter,
			index % 4 * 100,
			Math.floor(index / 4) * 100 + 90,
			100,
		).toSVG()
	)).join('');
	const svg = Buffer.from(`<svg width="400" height="400">${fontPath}</svg>`);
	const png = await sharp(svg).png().toBuffer();
	return png;
};

export default render;
