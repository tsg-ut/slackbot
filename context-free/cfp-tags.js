"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tags = void 0;
const lodash_1 = require("lodash");
exports.tags = new Map([
    // ['testTag', () => sample(['test1', 'test2', 'test4'])],
    [
        'no-drum',
        () => (0, lodash_1.sample)([
            'ねこ',
            '座布団',
            'セガサターン',
            'ミカヅキモ',
            'おこづかい帳',
            'バチカン市国',
            '液体窒素',
            '週刊誌',
            '消化器系',
            'ミソサザイ',
            'チャイルドシート',
            '釈迦三尊像',
            '瞬足',
            'Anitube',
            '緊急脱出用出口',
            'レレレのおじさん',
            '大憲章',
            'カヤック',
            '千歯扱き',
            '感情',
            '陸軍の統帥権',
        ]),
    ],
    ['number', () => Math.floor(Math.random() * 10).toString()],
]);
