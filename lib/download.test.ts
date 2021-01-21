jest.mock('axios');
jest.mock('fs', () => ({
    createWriteStream: jest.fn(),
    constants: { F_OK: 0 },
    access: jest.fn(),
}));

import axios from 'axios';
import fs from 'fs';

import { PassThrough } from 'stream';
import { download } from './download';

const fakeData = Buffer.from('FAKE_DATA');
const fakePath = '~/fake/path';
const fakeUrl = 'https://www.example.com';

beforeAll(() => {
    (<jest.Mock> axios.get).mockImplementation(() => {
        const stream = new PassThrough();
        process.nextTick(() => {
            stream.end(fakeData);
        });
        return Promise.resolve({data: stream});
    });
})

beforeEach(() => {
    jest.clearAllMocks();
});

it('downloads fetched data to path', async () => {
    (<jest.Mock> (fs.access as any)).mockImplementation((_, __, callback) => {
        callback(true);
    });
    await Promise.all([
        new Promise<void>((resolve) => {
            (<jest.Mock> fs.createWriteStream).mockReturnValue(
                new PassThrough().on('data', (data) => {
                    expect(data).toBe(fakeData)
                    resolve();
                })
            );
        }),
        download(fakePath, fakeUrl)
    ]);
    expect((<jest.Mock> axios.get).mock.calls.length).toBe(1);
    expect((<jest.Mock> axios.get).mock.calls[0][0]).toBe(fakeUrl);
    expect((<jest.Mock> fs.createWriteStream).mock.calls.length).toBe(1);
    expect((<jest.Mock> fs.createWriteStream).mock.calls[0][0]).toBe(fakePath);
});

it('does not download when file exists', async () => {
    (<jest.Mock> (fs.access as any)).mockImplementation((_, __, callback) => {
        callback(false);
    });
    await download(fakePath, fakeUrl);
    expect((<jest.Mock> axios.get).mock.calls.length).toBe(0);
    expect((<jest.Mock> fs.createWriteStream).mock.calls.length).toBe(0);
});
