"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var TaikoNote;
(function (TaikoNote) {
    TaikoNote[TaikoNote["Void"] = 0] = "Void";
    TaikoNote[TaikoNote["Ka"] = 1] = "Ka";
    TaikoNote[TaikoNote["Don"] = 2] = "Don";
})(TaikoNote || (TaikoNote = {}));
const taikoNotePtn = String.raw `(?:ドン?|コ|カッ?)`;
const parseDoka = (str) => {
    const result = [];
    const re = new RegExp(String.raw `${taikoNotePtn}|[\s\S]`, "g");
    for (let m; (m = re.exec(str));) {
        switch (m[0]) {
            case "ド":
            case "コ":
                result.push(TaikoNote.Don);
                break;
            case "ドン":
                result.push(TaikoNote.Don, TaikoNote.Void);
                break;
            case "カ":
                result.push(TaikoNote.Ka);
                break;
            case "カッ":
                result.push(TaikoNote.Ka, TaikoNote.Void);
                break;
            case " ":
            case "\u3000":
                result.push(TaikoNote.Void);
                break;
            default:
                result.push(m[0]);
                break;
        }
    }
    return result;
};
const emojifyNotes = (notes) => {
    const emojis = [];
    const noteToChar = (note) => {
        switch (note) {
            case TaikoNote.Void:
                return "v";
            case TaikoNote.Ka:
                return "k";
            case TaikoNote.Don:
                return "d";
        }
    };
    for (let i = 0; i - 1 < notes.length; i += 2) {
        const leftNote = (i - 1 < 0) ? TaikoNote.Void : notes[i - 1];
        const cntrNote = (i >= notes.length) ? TaikoNote.Void : notes[i];
        const rghtNote = (i + 1 >= notes.length) ? TaikoNote.Void : notes[i + 1];
        emojis.push(`:taiko-${noteToChar(leftNote)}${noteToChar(cntrNote)}${noteToChar(rghtNote)}-notes:`);
    }
    while (emojis[emojis.length - 1] === ':taiko-vvv-notes:') {
        emojis.pop();
    }
    return emojis.join("");
};
const emojifyScore = (score) => {
    const resultTexts = [];
    {
        let notes = [];
        for (const item of score) {
            if (typeof item === "string") {
                if (notes.length) {
                    const scoreText = emojifyNotes(notes);
                    resultTexts.push(scoreText);
                    notes = [];
                }
                resultTexts.push(item);
            }
            else {
                notes.push(item);
            }
        }
        if (notes.length) {
            const scoreText = emojifyNotes(notes);
            resultTexts.push(scoreText);
        }
    }
    return resultTexts.join("");
};
exports.default = ({ eventClient, webClient: slack }) => {
    eventClient.on('message', async (message) => {
        // if (message.channel !== process.env.CHANNEL_SANDBOX) {
        // if (!message.channel.startsWith('D')) {
        if (message.channel !== process.env.CHANNEL_SANDBOX && !message.channel.startsWith('D')) {
            return;
        }
        if (!message.text) {
            return;
        }
        const postMessage = (text) => slack.chat.postMessage({
            channel: message.channel,
            text,
            username: 'taiko',
            icon_emoji: ':taiko-vkv-notes:',
        });
        if (message.text.startsWith("@taiko")) {
            const text = message.text.substring("@taiko".length).trim();
            const score = parseDoka(text);
            if (!score) {
                return;
            }
            const emojiScore = emojifyScore(score);
            postMessage(emojiScore);
        }
        if (new RegExp(String.raw `^(${taikoNotePtn}[ \u3000\n]*)+$`).test(message.text)) {
            const score = parseDoka(message.text);
            if (!score) {
                return;
            }
            const emojiScore = emojifyScore(score);
            postMessage(emojiScore);
        }
    });
};
