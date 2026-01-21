"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const sqlite = __importStar(require("sqlite"));
const sqlite3_1 = __importDefault(require("sqlite3"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const concat_stream_1 = __importDefault(require("concat-stream"));
const lodash_1 = require("lodash");
const boards_json_1 = __importDefault(require("./boards.json"));
const stocks = [];
// 6x6 format to 20x20 format
const convertToNewFormat = (board) => (Array(400).fill(null).map((e, i) => {
    const x = i % 20;
    const y = Math.floor(i / 20);
    if (x < 6 && y < 6 && board[y * 6 + x] !== undefined) {
        return board[y * 6 + x];
    }
    return null;
}));
const generate = async (usedAt) => {
    if (stocks.length === 0) {
        const generator = (0, child_process_1.spawn)('../target/release/crossword_generator_main', { cwd: __dirname });
        const output = await new Promise((resolve) => {
            generator.stdout.pipe((0, concat_stream_1.default)({ encoding: 'buffer' }, (data) => {
                resolve(data);
            }));
        });
        const lines = output.toString().split('\n').filter((line) => line);
        for (const line of lines) {
            const [index, board] = line.split(',');
            stocks.push({ index: parseInt(index), board: board.split('').map((char) => char === '　' ? null : char) });
        }
    }
    const { index, board } = stocks.shift();
    const constraints = boards_json_1.default[index];
    const words = (0, lodash_1.sortBy)(constraints, ({ index }) => index).map(({ cells }) => (cells.map((cell) => board[cell]).join('')));
    const db = await sqlite.open({
        filename: path_1.default.join(__dirname, 'crossword.sqlite3'),
        driver: sqlite3_1.default.Database,
    });
    const descriptions = await Promise.all(words.map((word) => (db.get('SELECT * FROM words WHERE ruby = ? ORDER BY RANDOM() LIMIT 1', word))));
    return {
        words,
        descriptions: descriptions.map((description, index) => ({
            ...description,
            descriptionId: (index + 1).toString(),
        })),
        board: convertToNewFormat(board),
        boardId: `crossword-board-${index + 1}`,
        constraints: constraints.map((constraint) => ({
            cells: constraint.cells.map((cell) => {
                const x = cell % 6;
                const y = Math.floor(cell / 6);
                return y * 20 + x;
            }),
            descriptionId: constraint.index.toString(),
        })),
    };
};
exports.default = generate;
