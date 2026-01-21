"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderCrossword = void 0;
const sharp_1 = __importDefault(require("sharp"));
const loadFont_1 = __importDefault(require("../lib/loadFont"));
const path_1 = __importDefault(require("path"));
const lodash_1 = require("lodash");
const promises_1 = __importDefault(require("fs/promises"));
const common_tags_1 = require("common-tags");
const render = async (board, { color = 'black' }) => {
    const font = await (0, loadFont_1.default)('Noto Serif JP Bold');
    const letterPaths = board.map((letter, index) => (font.getPath(letter, index % 4 * 100, Math.floor(index / 4) * 100 + 90, 100).toSVG(2).replace('<path', `<path fill="${color}"`))).join('');
    const svg = Buffer.from(`<svg width="400" height="400">${letterPaths}</svg>`);
    const png = await (0, sharp_1.default)(svg).png().toBuffer();
    return png;
};
exports.default = render;
const renderCrossword = async (board, boardId) => {
    const font = await (0, loadFont_1.default)('Noto Serif JP Bold');
    const cells = board.flatMap((cell, index) => {
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
        return promises_1.default.readFile(path_1.default.join(__dirname, `${boardId}.png`));
    }
    const letterPaths = cells.map((cell) => (font.getPath(cell.letter, cell.x * 100 + 25, cell.y * 100 + 105, 90).toSVG(2).replace('<path', `<path fill="${cell.color}"`)));
    const maxX = (0, lodash_1.max)(cells.map(({ x }) => x));
    const maxY = (0, lodash_1.max)(cells.map(({ y }) => y));
    const svg = Buffer.from((0, common_tags_1.stripIndents) `
		<svg width="${maxX * 100 + 130}" height="${maxY * 100 + 130}">
			${letterPaths.join('')}
		</svg>
	`);
    return (0, sharp_1.default)(path_1.default.join(__dirname, `${boardId}.png`))
        .composite([{ input: svg, top: 0, left: 0 }])
        .png()
        .toBuffer();
};
exports.renderCrossword = renderCrossword;
