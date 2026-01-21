"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const custom_responses_1 = __importDefault(require("./custom-responses"));
describe('better-custom-response', () => {
    it('either one of array and function', async () => {
        for (const customResponse of custom_responses_1.default) {
            expect((customResponse.outputFunction !== undefined) !== (customResponse.outputArray !== undefined)).toBe(true);
        }
    });
});
