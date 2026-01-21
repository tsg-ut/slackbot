"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.download = void 0;
const fs_1 = __importDefault(require("fs"));
const axios_1 = __importDefault(require("axios"));
const download = async (path, url) => {
    const dataExists = await new Promise((resolve) => {
        fs_1.default.access(path, fs_1.default.constants.F_OK, (error) => {
            resolve(!error);
        });
    });
    return dataExists ? undefined : new Promise(async (resolve, reject) => {
        const response = await axios_1.default.get(url, { responseType: 'stream' });
        response.data.pipe(fs_1.default.createWriteStream(path))
            .on('finish', () => {
            resolve(undefined);
        })
            .on('error', reject);
    });
};
exports.download = download;
