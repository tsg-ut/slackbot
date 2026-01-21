'use strict';
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
jest.mock('cloudinary');
jest.mock('./rust-proxy');
jest.mock('../achievements');
jest.mock('../lib/slackUtils');
const cloudinary_1 = __importDefault(require("cloudinary"));
const rust_proxy = __importStar(require("./rust-proxy"));
const index_1 = __importDefault(require("./index"));
const slackMock_1 = __importDefault(require("../lib/slackMock"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const get_data = rust_proxy.get_data;
get_data.mockImplementation((x) => {
    return new Promise((resolve) => {
        resolve(fs_1.default.readFileSync(path_1.default.join(__dirname, 'rust_test_output.txt')).toString());
    });
});
const cloudinaryMock = cloudinary_1.default;
// ./node_modules/jest/bin/jest.js --verbose --coverage ./ricochet-robots/
describe('hyperrobot', () => {
    let slack = null;
    beforeEach(() => {
        slack = new slackMock_1.default();
        process.env.CHANNEL_SANDBOX = slack.fakeChannel;
        (0, index_1.default)(slack);
        jest.useFakeTimers();
    });
    afterEach(() => {
        jest.useRealTimers();
    });
    describe('base', () => {
        it('responds to ハイパーロボット', async () => {
            cloudinaryMock.url = 'https://hoge.com/hoge.png';
            const response = await slack.getResponseTo('ハイパーロボット');
            const attachments = 'attachments' in response ? response.attachments : [];
            const blocks = 'blocks' in response ? response.blocks : [];
            expect(get_data).toBeCalledTimes(1);
            expect(get_data).toBeCalledWith({ depth: 1000, size: { h: 7, w: 9 }, numOfWalls: 15 });
            expect('username' in response && response.username).toBe('hyperrobot');
            expect(response.text).toContain('10手詰めです');
            expect(attachments).toHaveLength(0);
            expect(blocks).toHaveLength(1);
            expect(blocks[0].type).toBe('section');
            expect(blocks[0].accessory?.type).toBe('image');
        }, 60000);
    });
    describe('battle', () => {
        it('responds to ハイパーロボットバトル & responds to first bidding', async () => {
            cloudinaryMock.url = 'https://hoge.com/hoge.png';
            {
                const response = await slack.getResponseTo('ハイパーロボットバトル');
                const attachments = 'attachments' in response ? response.attachments : [];
                expect('username' in response && response.username).toBe('hyperrobot');
                expect(response.text).toContain(':question:手詰めです');
                expect(attachments).toHaveLength(1);
            }
            {
                const response = await slack.getResponseTo('3');
                expect('username' in response && response.username).toBe('hyperrobot');
                expect(response.text).toContain('宣言終了予定時刻:');
            }
        });
    });
});
