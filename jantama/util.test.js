"use strict";
/* eslint-env jest */
Object.defineProperty(exports, "__esModule", { value: true });
const util_1 = require("./util");
describe('extractMajsoulId', () => {
    it('extracts majsoul id from url', () => {
        const result = (0, util_1.extractMajsoulId)('雀魂牌譜: https://game.mahjongsoul.com/?paipu=211204-7d8da604-bbec-49f9-8f41-de906570a122_a436601096');
        expect(result).toStrictEqual('211204-7d8da604-bbec-49f9-8f41-de906570a122');
    });
    it('returns null when URL is not found in the given text', () => {
        const result = (0, util_1.extractMajsoulId)('hello');
        expect(result).toStrictEqual(null);
    });
});
