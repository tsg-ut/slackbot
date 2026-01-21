"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
jest.mock('axios');
jest.mock('fs', () => ({
    createWriteStream: jest.fn(),
    constants: { F_OK: 0 },
    access: jest.fn(),
}));
const axios_1 = __importDefault(require("axios"));
const fs_1 = __importDefault(require("fs"));
const stream_1 = require("stream");
const download_1 = require("./download");
const fakeData = Buffer.from('FAKE_DATA');
const fakePath = '~/fake/path';
const fakeUrl = 'https://www.example.com';
beforeAll(() => {
    axios_1.default.get.mockImplementation(() => {
        const stream = new stream_1.PassThrough();
        process.nextTick(() => {
            stream.end(fakeData);
        });
        return Promise.resolve({ data: stream });
    });
});
beforeEach(() => {
    jest.clearAllMocks();
});
it('downloads fetched data to path', async () => {
    fs_1.default.access.mockImplementation((_, __, callback) => {
        callback(true);
    });
    await Promise.all([
        new Promise((resolve) => {
            fs_1.default.createWriteStream.mockReturnValue(new stream_1.PassThrough().on('data', (data) => {
                expect(data).toBe(fakeData);
                resolve();
            }));
        }),
        (0, download_1.download)(fakePath, fakeUrl)
    ]);
    expect(axios_1.default.get.mock.calls.length).toBe(1);
    expect(axios_1.default.get.mock.calls[0][0]).toBe(fakeUrl);
    expect(fs_1.default.createWriteStream.mock.calls.length).toBe(1);
    expect(fs_1.default.createWriteStream.mock.calls[0][0]).toBe(fakePath);
});
it('does not download when file exists', async () => {
    fs_1.default.access.mockImplementation((_, __, callback) => {
        callback(false);
    });
    await (0, download_1.download)(fakePath, fakeUrl);
    expect(axios_1.default.get.mock.calls.length).toBe(0);
    expect(fs_1.default.createWriteStream.mock.calls.length).toBe(0);
});
