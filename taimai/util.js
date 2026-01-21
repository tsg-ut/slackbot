"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatOutlineUnfilled = formatOutlineUnfilled;
exports.formatOutlineFilled = formatOutlineFilled;
exports.formatOutlineDynamic = formatOutlineDynamic;
const config_1 = __importDefault(require("./config"));
function formatOutlineUnfilled(outline, pieces, focus = null) {
    let tokens = [];
    for (let i = 0; i < outline.length; i++) {
        if (outline[i] !== '') {
            tokens.push(`${outline[i]}`);
        }
        if (i == outline.length - 1) {
            continue;
        }
        if ((focus === null || focus === i) && !pieces[i]) {
            tokens.push(` ${config_1.default.placeholders[i].repeat(5)} `);
        }
        else {
            tokens.push('◯'.repeat(5));
        }
    }
    tokens.push('?');
    return tokens.join('');
}
function formatOutlineFilled(outline, pieces) {
    let tokens = [];
    for (let i = 0; i < outline.length; i++) {
        tokens.push(outline[i]);
        if (i == outline.length - 1) {
            continue;
        }
        tokens.push(` *${pieces[i]}* `);
    }
    tokens.push('?');
    return tokens.join('');
}
function formatOutlineDynamic(outline, pieces) {
    if (pieces.every(piece => piece)) {
        return formatOutlineFilled(outline, pieces);
    }
    else {
        return formatOutlineUnfilled(outline, pieces);
    }
}
