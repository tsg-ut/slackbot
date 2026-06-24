import sharp from 'sharp';
import {stripIndents} from 'common-tags';
import loadFont from '../lib/loadFont';

const GRID_SIZE = 7;
const CELL_SIZE = 80;
const LABEL_MARGIN = 40;
const PADDING = 20;
const WIDTH = LABEL_MARGIN + GRID_SIZE * CELL_SIZE + PADDING * 2;
const HEIGHT = LABEL_MARGIN + GRID_SIZE * CELL_SIZE + PADDING * 2;
const FONT_SIZE = 56;
const LABEL_FONT_SIZE = 28;

export type RenderMode = 'normal' | 'success' | 'gameover';

export const renderWordSquare = async (board: (string | null)[], rowLabels: Map<number, string>, colLabels: Map<number, string>, mode: RenderMode = 'normal', answered: boolean[] = [], highlighted: Set<number> = new Set(), prerevealed: Set<number> = new Set()) => {
	const font = await loadFont('Noto Sans JP Medium');
	const rects: string[] = [];
	const letterPaths: string[] = [];
	const labelPaths: string[] = [];

	const gridOffsetX = LABEL_MARGIN + PADDING;
	const gridOffsetY = LABEL_MARGIN + PADDING;

	// Row labels on the left side
	for (let y = 0; y < GRID_SIZE; y++) {
		const label = rowLabels.get(y) ?? '?';
		const labelPath = font.getPath(label, 0, 0, LABEL_FONT_SIZE);
		const bounds = labelPath.getBoundingBox();
		const labelWidth = bounds.x2 - bounds.x1;
		const labelHeight = bounds.y2 - bounds.y1;
		const lx = (LABEL_MARGIN + PADDING - labelWidth) / 2 - bounds.x1;
		const ly = gridOffsetY + y * CELL_SIZE + (CELL_SIZE - labelHeight) / 2 - bounds.y1;
		labelPaths.push(
			font.getPath(label, lx, ly, LABEL_FONT_SIZE).toSVG(2).replace('<path', '<path fill="#555555"')
		);
	}

	// Column labels on the top side
	for (let x = 0; x < GRID_SIZE; x++) {
		const label = colLabels.get(x) ?? '?';
		const labelPath = font.getPath(label, 0, 0, LABEL_FONT_SIZE);
		const bounds = labelPath.getBoundingBox();
		const labelWidth = bounds.x2 - bounds.x1;
		const labelHeight = bounds.y2 - bounds.y1;
		const lx = gridOffsetX + x * CELL_SIZE + (CELL_SIZE - labelWidth) / 2 - bounds.x1;
		const ly = (LABEL_MARGIN + PADDING - labelHeight) / 2 - bounds.y1;
		labelPaths.push(
			font.getPath(label, lx, ly, LABEL_FONT_SIZE).toSVG(2).replace('<path', '<path fill="#555555"')
		);
	}

	for (let y = 0; y < GRID_SIZE; y++) {
		for (let x = 0; x < GRID_SIZE; x++) {
			const index = y * GRID_SIZE + x;
			const rectX = gridOffsetX + x * CELL_SIZE;
			const rectY = gridOffsetY + y * CELL_SIZE;
			let cellFill = prerevealed.has(index) ? '#e0e0e0' : '#ffffff';
			let strokeColor = '#222222';
			if (mode === 'gameover') {
				strokeColor = '#444444';
			}
			rects.push(
				`<rect x="${rectX}" y="${rectY}" width="${CELL_SIZE}" height="${CELL_SIZE}" fill="${cellFill}" stroke="${strokeColor}" stroke-width="2" />`
			);

			const letter = board[index];
			if (letter) {
				const letterPath = font.getPath(letter, 0, 0, FONT_SIZE);
				const letterBounds = letterPath.getBoundingBox();
				const letterWidth = letterBounds.x2 - letterBounds.x1;
				const letterHeight = letterBounds.y2 - letterBounds.y1;
				
				const centeredX = rectX + (CELL_SIZE - letterWidth) / 2 - letterBounds.x1;
				const centeredY = rectY + CELL_SIZE / 2 - letterBounds.y1 - letterHeight / 2;

				let letterFill = highlighted.has(index) ? '#d50000' : '#111111';
				if (mode === 'gameover') {
					letterFill = answered[index] ? '#111111' : '#888888';
				}

				letterPaths.push(
					font.getPath(
						letter,
						centeredX,
						centeredY,
						FONT_SIZE,
					).toSVG(2).replace('<path', `<path fill="${letterFill}"`)
				);
			}
		}
	}

	const svg = Buffer.from(stripIndents`
		<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
			<rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="#f9f9f7" />
			${labelPaths.join('')}
			${rects.join('')}
			${letterPaths.join('')}
		</svg>
	`);
	return sharp(svg).png().toBuffer();
};
