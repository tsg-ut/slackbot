"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable no-undef */
const lodash_1 = require("lodash");
const achievements_1 = __importDefault(require("./achievements"));
describe('achievements', () => {
    it('all ids are unique', () => {
        const ids = new Set(Array.from(achievements_1.default.values()).map(({ id }) => id));
        expect(Array.from(achievements_1.default)).toHaveLength(ids.size);
    });
    it('all titles are unique', () => {
        const titles = new Set(Array.from(achievements_1.default.values()).map(({ title }) => title));
        expect(Array.from(achievements_1.default)).toHaveLength(titles.size);
    });
    it('no isolated category exists', () => {
        const categories = (0, lodash_1.countBy)(Array.from(achievements_1.default.values()).map(({ category }) => category));
        for (const count of Object.values(categories)) {
            expect(count).toBeGreaterThan(1);
        }
    });
    it('value is defined if counter is defined', () => {
        for (const achievement of achievements_1.default.values()) {
            if (achievement.counter !== undefined) {
                expect(achievement.value).toBeTruthy();
            }
        }
    });
});
