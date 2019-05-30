// @ts-ignore
import sharp from 'sharp';
import loadFont from '../lib/loadFont';
import path from 'path';
import fs from 'fs';
import {promisify} from 'util';

const render = async (board: string[], {color = 'black'}: {color: string}) => {
	const font = await loadFont();
	const fontPath = board.map((letter, index) => (
		font.getPath(
			letter,
			index % 4 * 100,
			Math.floor(index / 4) * 100 + 90,
			100,
		).toSVG().replace('<path', `<path fill="${color}"`)
	)).join('');
	const svg = Buffer.from(`<svg width="400" height="400">${fontPath}</svg>`);
	const png = await sharp(svg).png().toBuffer();
	return png;
};

export default render;

export const renderCrossword = async (board: {letter: string, color: string}[]) => {
	const font = await loadFont();
	const fontPath = board.map((cell, index) => (
		cell === null ? '' : font.getPath(
			cell.letter,
			index % 4 * 100 + 25,
			Math.floor(index / 4) * 100 + 105,
			90,
		).toSVG().replace('<path', `<path fill="${cell.color}"`)
	)).join('');
	const svg = Buffer.from(`<svg width="550" height="550">${fontPath}</svg>`);
	const png = await sharp(path.join(__dirname, 'crossword-board.png')).overlayWith(svg).png().toBuffer();
	return png;
};
