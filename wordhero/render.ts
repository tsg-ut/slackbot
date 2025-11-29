import sharp from 'sharp';
import loadFont from '../lib/loadFont';
import path from 'path';
import {max} from 'lodash';
import fs from 'fs/promises';
import {stripIndents} from 'common-tags';

const render = async (board: string[], {color = 'black'}: {color: string}) => {
	const font = await loadFont('Noto Serif JP Bold');
	const letterPaths = board.map((letter, index) => (
		font.getPath(
			letter,
			index % 4 * 100,
			Math.floor(index / 4) * 100 + 90,
			100,
		).toSVG(2).replace('<path', `<path fill="${color}"`)
	)).join('');
	const svg = Buffer.from(`<svg width="400" height="400">${letterPaths}</svg>`);
	const png = await sharp(svg).png().toBuffer();
	return png;
};

export default render;

interface CellInfo {
	x: number;
	y: number;
	letter: string;
	color: string;
}

export const renderCrossword = async (board: ({letter: string | null, color: string} | null)[], boardId: string) => {
	const font = await loadFont('Noto Serif JP Bold');
	const cells = board.flatMap<CellInfo>((cell, index) => {
		if (cell === null || cell.letter === null) {
			return [];
		}
		return [{
			x: index % 20,
			y: Math.floor(index / 20),
			letter: cell.letter,
			color: cell.color,
		}];
	});

	if (cells.length === 0) {
		return fs.readFile(path.join(__dirname, `${boardId}.png`));
	}

	const letterPaths = cells.map((cell) => (
		font.getPath(
			cell.letter,
			cell.x * 100 + 25,
			cell.y * 100 + 105,
			90,
		).toSVG(2).replace('<path', `<path fill="${cell.color}"`)
	));
	const maxX = max(cells.map(({x}) => x));
	const maxY = max(cells.map(({y}) => y));
	const svg = Buffer.from(stripIndents`
		<svg width="${maxX * 100 + 130}" height="${maxY * 100 + 130}">
			${letterPaths.join('')}
		</svg>
	`);
	return sharp(path.join(__dirname, `${boardId}.png`))
		.composite([{input: svg, top: 0, left: 0}])
		.png()
		.toBuffer();
};
