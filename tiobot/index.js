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
Object.defineProperty(exports, "__esModule", { value: true });
const common_tags_1 = require("common-tags");
const zlib = __importStar(require("zlib"));
exports.default = ({ eventClient, webClient: slack }) => {
    eventClient.on('message', async (message) => {
        if (!message.text) {
            return;
        }
        if (message.channel !== process.env.CHANNEL_SANDBOX) {
            return;
        }
        const { text } = message;
        let matches = null;
        if ((matches = text.match(/https:\/\/tio.run\/##([\w@/]+)/))) {
            const [, data] = matches;
            const buffer = Buffer.from(data.replace(/@/g, '+'), 'base64');
            const rawData = await new Promise((resolve, reject) => {
                zlib.inflateRaw(buffer, (error, result) => {
                    if (error) {
                        reject(error);
                    }
                    else {
                        resolve(result);
                    }
                });
            });
            const segments = [];
            let pointer = -Infinity;
            for (const [index, byte] of rawData.entries()) {
                if (byte === 0xff) {
                    segments.push(rawData.slice(pointer + 1, index));
                    pointer = index;
                }
            }
            const [language, , codeData] = segments;
            const code = codeData.toString();
            const formattedText = (code.includes('\n') || code.includes('`')) ? `\`\`\`\n${code.toString()}\n\`\`\`` : `\n\`${code.toString()}\``;
            await slack.chat.postMessage({
                channel: process.env.CHANNEL_SANDBOX,
                text: (0, common_tags_1.stripIndent) `
					*${language.toString()}, ${codeData.length} bytes* ${formattedText}
				`,
                username: 'tiobot',
                icon_url: 'https://i.imgur.com/2mB02ZI.png',
            });
        }
    });
};
