import sharp from 'sharp';
import loadFont from '../lib/loadFont';

export default async (text: string) => {
	const font = await loadFont('Noto Serif JP Bold');
	const fontPath = font.getPath(text, 40, 310, 300);
	const box = fontPath.getBoundingBox();
	const svg = Buffer.from(`<svg width="${box.x2 + 40}" height="400">${fontPath.toSVG(3)}</svg>`);
	const png = await sharp(svg).png().toBuffer();
	return png;
};
