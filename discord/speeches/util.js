"use strict";
/* eslint-disable prefer-named-capture-group */
Object.defineProperty(exports, "__esModule", { value: true });
exports.textToSsml = void 0;
const lodash_1 = require("lodash");
const escapeXml = (text) => text.replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
const emphasisTemplate = '<emphasis level="strong"><prosody pitch="+3st">$1</prosody></emphasis>';
const textToSsml = (text, audioTags) => {
    let escapedText = escapeXml(text);
    escapedText = escapedText
        .replace(/\*\*(.+?)\*\*/g, emphasisTemplate)
        .replace(/__(.+?)__/g, emphasisTemplate)
        .replace(/\*(.+?)\*/g, emphasisTemplate)
        .replace(/_(.+?)_/g, emphasisTemplate);
    escapedText = escapedText.replaceAll(/\[(.+?)\]/g, (_match, tag) => {
        if (audioTags && (0, lodash_1.has)(audioTags, tag)) {
            return `<audio src="${escapeXml(audioTags[tag])}">${tag}</audio>`;
        }
        return tag;
    });
    // audioタグだけの場合になぜかバグるので0秒のbreakを挿入する
    return `${escapedText}<break time="0ms"/>`;
};
exports.textToSsml = textToSsml;
