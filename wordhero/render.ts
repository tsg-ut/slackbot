// @ts-ignore
import sharp from 'sharp';
import loadFont from '../lib/loadFont';
import path from 'path';
import {max} from 'lodash';

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

export const renderCrossword = async (board: {letter: string, color: string}[], boardIndex: number) => {
	const font = await loadFont();
	const fontPath = board.map((cell, index) => (
		(cell === null || cell.letter === null) ? '' : font.getPath(
			cell.letter,
			index % 6 * 100 + 25,
			Math.floor(index / 6) * 100 + 105,
			90,
		).toSVG().replace('<path', `<path fill="${cell.color}"`)
	)).join('');
	const cells = board.map((cell, index) => (cell === null || cell.letter === null) ? {x: 0, y: 0} : {x: index % 6 + 1, y: Math.floor(index / 6) + 1});
	const svg = Buffer.from(`<svg width="${max(cells.map(({x}) => x)) * 100 + 30}" height="${max(cells.map(({y}) => y)) * 100 + 30}">${fontPath}</svg>`);
	const png = await sharp(path.join(__dirname, `crossword-board-${boardIndex + 1}.png`)).composite([{input: svg, top: 0, left: 0}]).png().toBuffer();
	return png;
};
