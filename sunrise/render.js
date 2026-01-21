"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const sharp_1 = __importDefault(require("sharp"));
const loadFont_1 = __importDefault(require("../lib/loadFont"));
exports.default = async (text) => {
    const font = await (0, loadFont_1.default)('Noto Serif JP Bold');
    const fontPath = font.getPath(text, 40, 310, 300);
    const box = fontPath.getBoundingBox();
    const svg = Buffer.from(`<svg width="${box.x2 + 40}" height="400">${fontPath.toSVG(3)}</svg>`);
    const png = await (0, sharp_1.default)(svg).png().toBuffer();
    return png;
};
