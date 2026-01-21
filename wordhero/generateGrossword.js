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
exports.parseBoard = void 0;
const sqlite = __importStar(require("sqlite"));
const sqlite3_1 = __importDefault(require("sqlite3"));
const path_1 = __importDefault(require("path"));
const firestore_1 = __importDefault(require("../lib/firestore"));
const lodash_1 = require("lodash");
const Boards = firestore_1.default.collection('crossword_boards');
const parseBoard = (board) => {
    const lines = board.split('\n').filter((0, lodash_1.negate)(lodash_1.isEmpty));
    const cells = [];
    const width = (0, lodash_1.maxBy)(lines, (line) => line.length).length;
    const height = lines.length;
    for (const [y, line] of lines.entries()) {
        for (const [x, char] of Array.from(line).entries()) {
            if (char !== '　') {
                cells.push({ x, y });
            }
        }
    }
    const constraints = [];
    for (const y of Array(height).keys()) {
        let consecutiveCells = [];
        for (const x of Array(width).keys()) {
            const char = lines[y][x] || '　';
            if (char !== '　') {
                consecutiveCells.push(y * 20 + x);
            }
            else {
                if (consecutiveCells.length >= 3) {
                    constraints.push({
                        cells: consecutiveCells,
                        descriptionId: 'ヨコ',
                    });
                }
                consecutiveCells = [];
            }
        }
        if (consecutiveCells.length >= 3) {
            constraints.push({
                cells: consecutiveCells,
                descriptionId: 'ヨコ',
            });
        }
    }
    for (const x of Array(width).keys()) {
        let consecutiveCells = [];
        for (const y of Array(height).keys()) {
            const char = lines[y][x] || '　';
            if (char !== '　') {
                consecutiveCells.push(y * 20 + x);
            }
            else {
                if (consecutiveCells.length >= 3) {
                    constraints.push({
                        cells: consecutiveCells,
                        descriptionId: 'タテ',
                    });
                }
                consecutiveCells = [];
            }
        }
        if (consecutiveCells.length >= 3) {
            constraints.push({
                cells: consecutiveCells,
                descriptionId: 'タテ',
            });
        }
    }
    constraints.sort((a, b) => {
        if (a.descriptionId !== b.descriptionId) {
            return a.descriptionId === 'ヨコ' ? 1 : -1;
        }
        return a.cells[0] - b.cells[0];
    });
    const startingCells = constraints.map(({ cells }) => cells[0]);
    const uniqueStartingCells = Array.from(new Set(startingCells)).sort((a, b) => a - b);
    for (const constraint of constraints) {
        constraint.descriptionId += (uniqueStartingCells.findIndex((c) => c === constraint.cells[0]) + 1).toString();
    }
    const normalizedBoard = Array(400).fill(null).map((cell, i) => {
        const x = i % 20;
        const y = Math.floor(i / 20);
        if (y < height) {
            const cell = lines[y][x];
            if (cell === undefined || cell === '　') {
                return null;
            }
            return lines[y][x];
        }
        return null;
    });
    return {
        constraints: constraints,
        board: normalizedBoard,
    };
};
exports.parseBoard = parseBoard;
const generate = async (usedAt) => {
    const crosswordData = await firestore_1.default.runTransaction(async (transaction) => {
        const query = Boards.where('category', '==', 'grossword').where('used_at', '==', null);
        const results = await transaction.get(query);
        if (results.size === 0) {
            return null;
        }
        const crossword = (0, lodash_1.sample)(results.docs);
        transaction.update(crossword.ref, { used_at: usedAt });
        return crossword.data();
    });
    if (crosswordData === null) {
        return null;
    }
    const { board, constraints } = (0, exports.parseBoard)(crosswordData.board);
    const words = constraints.map(({ cells }) => (cells.map((cell) => board[cell]).join('')));
    const crosswordDb = await sqlite.open({
        filename: path_1.default.join(__dirname, 'crossword.sqlite3'),
        driver: sqlite3_1.default.Database,
    });
    const descriptions = await Promise.all(words.map((word) => (crosswordDb.get('SELECT * FROM words WHERE ruby = ? ORDER BY RANDOM() LIMIT 1', word))));
    return {
        words,
        descriptions: descriptions.map((description, index) => ({
            ...description,
            descriptionId: constraints[index].descriptionId,
        })),
        board,
        boardId: crosswordData.type.replace('-', '-board-'),
        constraints,
    };
};
exports.default = generate;
