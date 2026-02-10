import sharp from 'sharp';
import {stripIndents} from 'common-tags';
import loadFont from '../lib/loadFont';

const GRID_SIZE = 7;
const CELL_SIZE = 80;
const PADDING = 20;
const WIDTH = GRID_SIZE * CELL_SIZE + PADDING * 2;
const HEIGHT = WIDTH;
const FONT_SIZE = 56;

export const renderWordSquare = async (board: (string | null)[]) => {
	const font = await loadFont('Noto Sans JP Medium');
	const rects: string[] = [];
	const letterPaths: string[] = [];

	for (let y = 0; y < GRID_SIZE; y++) {
		for (let x = 0; x < GRID_SIZE; x++) {
			const index = y * GRID_SIZE + x;
			const rectX = PADDING + x * CELL_SIZE;
			const rectY = PADDING + y * CELL_SIZE;
			rects.push(
				`<rect x="${rectX}" y="${rectY}" width="${CELL_SIZE}" height="${CELL_SIZE}" fill="#ffffff" stroke="#222222" stroke-width="2" />`
			);

			const letter = board[index];
			if (letter) {
				const letterPath = font.getPath(letter, 0, 0, FONT_SIZE);
				const letterBounds = letterPath.getBoundingBox();
				const letterWidth = letterBounds.x2 - letterBounds.x1;
				const letterHeight = letterBounds.y2 - letterBounds.y1;
				
				const centeredX = rectX + (CELL_SIZE - letterWidth) / 2 - letterBounds.x1;
				const centeredY = rectY + CELL_SIZE / 2 - letterBounds.y1 - letterHeight / 2;
				
				letterPaths.push(
					font.getPath(
						letter,
						centeredX,
						centeredY,
						FONT_SIZE,
					).toSVG(2).replace('<path', '<path fill="#111111"')
				);
			}
		}
	}

	const svg = Buffer.from(stripIndents`
		<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
			<rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="#f9f9f7" />
			${rects.join('')}
			${letterPaths.join('')}
		</svg>
	`);
	return sharp(svg).png().toBuffer();
};
