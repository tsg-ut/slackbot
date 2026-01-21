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
const opentype = __importStar(require("opentype.js"));
// @ts-expect-error
const download_1 = __importDefault(require("download"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const _ = __importStar(require("lodash"));
const fontURLs = new Map([
    ['Noto Serif JP Thin', 'https://github.com/googlefonts/noto-cjk/raw/main/Serif/OTF/Japanese/NotoSerifCJKjp-Thin.otf'],
    ['Noto Serif JP Light', 'https://github.com/googlefonts/noto-cjk/raw/main/Serif/OTF/Japanese/NotoSerifCJKjp-Light.otf'],
    ['Noto Serif JP DemiLight', 'https://github.com/googlefonts/noto-cjk/raw/main/Serif/OTF/Japanese/NotoSerifCJKjp-DemiLight.otf'],
    ['Noto Serif JP Regular', 'https://github.com/googlefonts/noto-cjk/raw/main/Serif/OTF/Japanese/NotoSerifCJKjp-Regular.otf'],
    ['Noto Serif JP Medium', 'https://github.com/googlefonts/noto-cjk/raw/main/Serif/OTF/Japanese/NotoSerifCJKjp-Medium.otf'],
    ['Noto Serif JP Bold', 'https://github.com/googlefonts/noto-cjk/raw/main/Serif/OTF/Japanese/NotoSerifCJKjp-Bold.otf'],
    ['Noto Serif JP Black', 'https://github.com/googlefonts/noto-cjk/raw/main/Serif/OTF/Japanese/NotoSerifCJKjp-Black.otf'],
    ['Noto Sans JP Thin', 'https://github.com/googlefonts/noto-cjk/raw/main/Sans/OTF/Japanese/NotoSansCJKjp-Thin.otf'],
    ['Noto Sans JP Light', 'https://github.com/googlefonts/noto-cjk/raw/main/Sans/OTF/Japanese/NotoSansCJKjp-Light.otf'],
    ['Noto Sans JP DemiLight', 'https://github.com/googlefonts/noto-cjk/raw/main/Sans/OTF/Japanese/NotoSansCJKjp-DemiLight.otf'],
    ['Noto Sans JP Regular', 'https://github.com/googlefonts/noto-cjk/raw/main/Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf'],
    ['Noto Sans JP Medium', 'https://github.com/googlefonts/noto-cjk/raw/main/Sans/OTF/Japanese/NotoSansCJKjp-Medium.otf'],
    ['Noto Sans JP Bold', 'https://github.com/googlefonts/noto-cjk/raw/main/Sans/OTF/Japanese/NotoSansCJKjp-Bold.otf'],
    ['Noto Sans JP Black', 'https://github.com/googlefonts/noto-cjk/raw/main/Sans/OTF/Japanese/NotoSansCJKjp-Black.otf'],
]);
const loadFont = async (fontName) => {
    const url = fontURLs.get(fontName);
    if (url == null) {
        return null;
    }
    const fileName = _.last(url.split('/'));
    const fontPath = path_1.default.resolve(__dirname, fileName);
    const fontExists = await new Promise((resolve) => {
        fs_1.default.access(fontPath, fs_1.default.constants.F_OK, (error) => {
            resolve(!error);
        });
    });
    if (!fontExists) {
        await (0, download_1.default)(url, __dirname, {
            filename: fileName,
        });
    }
    const font = await new Promise((resolve, reject) => {
        opentype.load(fontPath, (error, f) => {
            if (error) {
                reject(error);
            }
            else {
                resolve(f);
            }
        });
    });
    return font;
};
exports.default = loadFont;
