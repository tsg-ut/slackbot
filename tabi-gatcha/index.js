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
// eslint-disable-next-line import/no-namespace
const Turf = __importStar(require("@turf/turf"));
const fs_extra_1 = __importDefault(require("fs-extra"));
const pluscodes_1 = require("pluscodes");
const range = (lower, upper) => Math.random() * (upper - lower) + lower;
exports.default = ({ eventClient, webClient: slack }) => {
    eventClient.on('message', async (message) => {
        if (message.channel !== process.env.CHANNEL_SANDBOX || !message.text?.startsWith('ダーツの旅')) {
            return;
        }
        const prefecture = message.text.slice(5).trim();
        const japan = await fs_extra_1.default.readJson(__dirname + '/japan.geojson');
        const prefectureGeo = prefecture === '' ? japan : japan.features.find((feature) => (feature.properties.nam_ja === prefecture));
        if (prefectureGeo === undefined) {
            await slack.chat.postMessage({
                text: `そんな都道府県はないよ:anger:`,
                channel: process.env.CHANNEL_SANDBOX,
            });
            return;
        }
        while (true) {
            const longitude = range(120, 155);
            const latitude = range(20, 46);
            const points = Turf.points([[longitude, latitude]]);
            const res = Turf.pointsWithinPolygon(points, prefectureGeo);
            if (res.features.length > 0) {
                const pluscode = (0, pluscodes_1.encode)({ longitude, latitude });
                const url = `https://www.google.co.jp/maps/search/${encodeURIComponent(pluscode)}`;
                const image = `https://maps.googleapis.com/maps/api/streetview?size=800x300&key=AIzaSyCOZhs7unM1rAup82uEjzTd-BLApvqwcQE&radius=10000&location=${latitude},${longitude}`;
                const direction = `https://www.google.co.jp/maps/dir/My+Location/${encodeURIComponent(pluscode)}`;
                const streetViewUrl = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${latitude},${longitude}`;
                await slack.chat.postMessage({
                    text: `${url} <${direction}|[経路案内]>`,
                    channel: process.env.CHANNEL_SANDBOX,
                    attachments: [
                        {
                            title: 'Street View',
                            image_url: image,
                            title_link: streetViewUrl,
                        },
                    ],
                });
                break;
            }
        }
    });
};
