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
exports.getSpeech = exports.speechConfig = exports.getDefaultVoiceMeta = exports.Emotion = exports.Voice = void 0;
const logger_1 = __importDefault(require("../../lib/logger"));
const amazon_1 = __importDefault(require("./amazon"));
const azure_1 = __importDefault(require("./azure"));
const google_1 = __importDefault(require("./google"));
const openai_1 = __importDefault(require("./openai"));
const voicetext_1 = __importStar(require("./voicetext"));
Object.defineProperty(exports, "Emotion", { enumerable: true, get: function () { return voicetext_1.Emotion; } });
const voicevox_1 = __importDefault(require("./voicevox"));
const log = logger_1.default.child({ bot: 'discord' });
var Voice;
(function (Voice) {
    Voice["A"] = "A";
    Voice["B"] = "B";
    Voice["C"] = "C";
    Voice["D"] = "D";
    Voice["E"] = "E";
    Voice["F"] = "F";
    Voice["G"] = "G";
    Voice["H"] = "H";
    Voice["I"] = "I";
    Voice["J"] = "J";
    Voice["K"] = "K";
    Voice["L"] = "L";
    Voice["M"] = "M";
    Voice["N"] = "N";
    Voice["O"] = "O";
    Voice["P"] = "P";
    Voice["Q"] = "Q";
    Voice["R"] = "R";
    Voice["S"] = "S";
    Voice["T"] = "T";
    Voice["U"] = "U";
    Voice["V"] = "V";
    Voice["W"] = "W";
    Voice["X"] = "X";
    Voice["Y"] = "Y";
    Voice["Z"] = "Z";
    Voice["AA"] = "AA";
    Voice["AB"] = "AB";
    Voice["AC"] = "AC";
    Voice["AD"] = "AD";
    Voice["AE"] = "AE";
    Voice["AF"] = "AF";
    Voice["AG"] = "AG";
    Voice["AH"] = "AH";
    Voice["AI"] = "AI";
    Voice["AJ"] = "AJ";
    Voice["AK"] = "AK";
    Voice["AL"] = "AL";
    Voice["AM"] = "AM";
    Voice["AN"] = "AN";
    Voice["AO"] = "AO";
    Voice["AP"] = "AP";
    Voice["AQ"] = "AQ";
    Voice["AR"] = "AR";
    Voice["AS"] = "AS";
    Voice["AT"] = "AT";
    Voice["AU"] = "AU";
    Voice["AV"] = "AV";
    Voice["AW"] = "AW";
    Voice["AX"] = "AX";
    Voice["AY"] = "AY";
    Voice["AZ"] = "AZ";
    Voice["BA"] = "BA";
    Voice["BB"] = "BB";
    Voice["BC"] = "BC";
    Voice["BD"] = "BD";
    Voice["BE"] = "BE";
    Voice["BF"] = "BF";
    Voice["BG"] = "BG";
    Voice["BH"] = "BH";
    Voice["BI"] = "BI";
    Voice["BJ"] = "BJ";
    Voice["BK"] = "BK";
})(Voice || (exports.Voice = Voice = {}));
const getDefaultVoiceMeta = () => ({
    speed: 1.2,
    emotion: voicetext_1.Emotion.normal,
    emolv: 2,
});
exports.getDefaultVoiceMeta = getDefaultVoiceMeta;
exports.speechConfig = new Map([
    [Voice.A, { provider: 'google', name: 'ja-JP-Wavenet-A', lang: 'ja-JP' }],
    [Voice.B, { provider: 'google', name: 'ja-JP-Wavenet-B', lang: 'ja-JP' }],
    [Voice.C, { provider: 'google', name: 'ja-JP-Wavenet-C', lang: 'ja-JP' }],
    [Voice.D, { provider: 'google', name: 'ja-JP-Wavenet-D', lang: 'ja-JP' }],
    [Voice.E, { provider: 'amazon', name: 'Mizuki' }],
    [Voice.F, { provider: 'amazon', name: 'Takumi' }],
    [Voice.G, { provider: 'azure', name: 'ja-JP-NanamiNeural' }],
    [Voice.H, { provider: 'azure', name: 'ja-JP-KeitaNeural' }],
    [Voice.I, { provider: 'azure', name: 'ja-JP-Ayumi' }],
    [Voice.J, { provider: 'azure', name: 'ja-JP-HarukaRUS' }],
    [Voice.K, { provider: 'azure', name: 'ja-JP-Ichiro' }],
    [Voice.L, { provider: 'voicetext', name: 'show' }],
    [Voice.M, { provider: 'voicetext', name: 'haruka', emotional: true }],
    [Voice.N, { provider: 'voicetext', name: 'hikari', emotional: true }],
    [Voice.O, { provider: 'voicetext', name: 'takeru', emotional: true }],
    [Voice.P, { provider: 'voicetext', name: 'santa', emotional: true }],
    [Voice.Q, { provider: 'voicetext', name: 'bear', emotional: true }],
    [Voice.R, { provider: 'google', name: 'en-US-Wavenet-H', lang: 'en-US' }],
    [Voice.S, { provider: 'google', name: 'en-US-Wavenet-I', lang: 'en-US' }],
    [Voice.T, { provider: 'voicevox', name: 'metan', emotional: true }],
    [Voice.U, { provider: 'voicevox', name: 'zundamon', emotional: true }],
    [Voice.V, { provider: 'voicevox', name: 'tsumugi' }],
    [Voice.W, { provider: 'voicevox', name: 'ritsu' }],
    [Voice.X, { provider: 'voicevox', name: 'hau' }],
    [Voice.Y, { provider: 'voicevox', name: 'takehiro' }],
    [Voice.Z, { provider: 'voicevox', name: 'torataro' }],
    [Voice.AA, { provider: 'voicevox', name: 'ryusei' }],
    [Voice.AB, { provider: 'voicevox', name: 'himari' }],
    [Voice.AC, { provider: 'voicevox', name: 'sora', emotional: true }],
    [Voice.AD, { provider: 'voicevox', name: 'sora_whisper' }],
    [Voice.AE, { provider: 'voicevox', name: 'mochiko' }],
    [Voice.AF, { provider: 'amazon', name: 'Takumi' }],
    [Voice.AG, { provider: 'voicevox', name: 'kenzaki' }],
    [Voice.AH, { provider: 'voicevox', name: 'zunda_whisper' }],
    [Voice.AI, { provider: 'google', name: 'ja-JP-Neural2-B', lang: 'ja-JP' }],
    [Voice.AJ, { provider: 'google', name: 'ja-JP-Neural2-C', lang: 'ja-JP' }],
    [Voice.AK, { provider: 'google', name: 'ja-JP-Neural2-D', lang: 'ja-JP' }],
    [Voice.AL, { provider: 'openai', model: 'tts-1', name: 'alloy' }],
    [Voice.AM, { provider: 'openai', model: 'tts-1', name: 'echo' }],
    [Voice.AN, { provider: 'openai', model: 'tts-1', name: 'fable' }],
    [Voice.AO, { provider: 'openai', model: 'tts-1', name: 'onyx' }],
    [Voice.AP, { provider: 'openai', model: 'tts-1', name: 'nova' }],
    [Voice.AQ, { provider: 'openai', model: 'tts-1', name: 'shimmer' }],
    [Voice.AR, { provider: 'amazon', name: 'Kazuha' }],
    [Voice.AS, { provider: 'amazon', name: 'Tomoko' }],
    [Voice.AT, { provider: 'azure', name: 'ja-JP-AoiNeural' }],
    [Voice.AU, { provider: 'azure', name: 'ja-JP-DaichiNeural' }],
    [Voice.AV, { provider: 'azure', name: 'ja-JP-MayuNeural' }],
    [Voice.AW, { provider: 'azure', name: 'ja-JP-NaokiNeural' }],
    [Voice.AX, { provider: 'azure', name: 'ja-JP-ShioriNeural' }],
    [Voice.AY, { provider: 'openai', model: 'tts-1', name: 'ash' }],
    [Voice.AZ, { provider: 'openai', model: 'tts-1', name: 'coral' }],
    [Voice.BA, { provider: 'openai', model: 'tts-1', name: 'sage' }],
    [Voice.BB, { provider: 'openai', model: 'gpt-4o-mini-tts', name: 'alloy' }],
    [Voice.BC, { provider: 'openai', model: 'gpt-4o-mini-tts', name: 'ash' }],
    [Voice.BD, { provider: 'openai', model: 'gpt-4o-mini-tts', name: 'ballad' }],
    [Voice.BE, { provider: 'openai', model: 'gpt-4o-mini-tts', name: 'coral' }],
    [Voice.BF, { provider: 'openai', model: 'gpt-4o-mini-tts', name: 'echo' }],
    [Voice.BG, { provider: 'openai', model: 'gpt-4o-mini-tts', name: 'fable' }],
    [Voice.BH, { provider: 'openai', model: 'gpt-4o-mini-tts', name: 'onyx' }],
    [Voice.BI, { provider: 'openai', model: 'gpt-4o-mini-tts', name: 'nova' }],
    [Voice.BJ, { provider: 'openai', model: 'gpt-4o-mini-tts', name: 'sage' }],
    [Voice.BK, { provider: 'openai', model: 'gpt-4o-mini-tts', name: 'shimmer' }],
    // coming soon
    // [Voice., {provider: 'voicevox', name: 'whitecul', emotional: true}],
    // [Voice., {provider: 'voicevox', name: 'goki', emotional: true}],
    // [Voice., {provider: 'voicevox', name: 'number7', emotional: true}],
]);
const getSpeech = (text, voiceType, meta, audioTags) => {
    const config = exports.speechConfig.get(voiceType);
    if (!config) {
        log.error(`AssertionError: Voice config not found for ${voiceType}`);
        return (0, google_1.default)(text, 'ja-JP-Wavenet-A', meta, audioTags);
    }
    if (config.provider === 'google') {
        return (0, google_1.default)(text, config.name, { ...meta, lang: config.lang }, audioTags);
    }
    if (config.provider === 'azure') {
        return (0, azure_1.default)(text, config.name, meta, audioTags);
    }
    if (config.provider === 'amazon') {
        return (0, amazon_1.default)(text, config.name, {
            ...meta,
            engine: voiceType === Voice.E || voiceType === Voice.F ? 'standard' : 'neural',
        });
    }
    if (config.provider === 'voicevox') {
        return (0, voicevox_1.default)(text, config.name, meta);
    }
    if (config.provider === 'openai') {
        return (0, openai_1.default)(text, config.name, { ...meta, engine: config.model });
    }
    return (0, voicetext_1.default)(text, config.name, meta);
};
exports.getSpeech = getSpeech;
