import axios from 'axios';
import fs from 'node:fs';
import { PassThrough } from 'stream';
import { download } from './download';
import type { Mock } from 'vitest';

vi.mock('axios');
vi.mock('node:fs', () => {
    const mock = {
        createWriteStream: vi.fn(),
        constants: {F_OK: 0},
        access: vi.fn(),
    };
    return {...mock, default: mock};
});
vi.mock('node:fs/promises', () => ({
    mkdir: vi.fn().mockResolvedValue(undefined),
}));

const fakeData = Buffer.from('FAKE_DATA');
const fakePath = '~/fake/path';
const fakeUrl = 'https://www.example.com';

beforeAll(() => {
    (<Mock> axios.get).mockImplementation(() => {
        const stream = new PassThrough();
        process.nextTick(() => {
            stream.end(fakeData);
        });
        return Promise.resolve({data: stream});
    });
})

beforeEach(() => {
    vi.clearAllMocks();
});

it('downloads fetched data to path', async () => {
    (<Mock> (fs.access as any)).mockImplementation((_, __, callback) => {
        callback(true);
    });
    await Promise.all([
        new Promise<void>((resolve) => {
            (<Mock> fs.createWriteStream).mockReturnValue(
                new PassThrough().on('data', (data) => {
                    expect(data).toBe(fakeData)
                    resolve();
                })
            );
        }),
        download(fakePath, fakeUrl)
    ]);
    expect((<Mock> axios.get).mock.calls.length).toBe(1);
    expect((<Mock> axios.get).mock.calls[0][0]).toBe(fakeUrl);
    expect((<Mock> fs.createWriteStream).mock.calls.length).toBe(1);
    expect((<Mock> fs.createWriteStream).mock.calls[0][0]).toBe(fakePath);
});

it('does not download when file exists', async () => {
    (<Mock> (fs.access as any)).mockImplementation((_, __, callback) => {
        callback(false);
    });
    await download(fakePath, fakeUrl);
    expect((<Mock> axios.get).mock.calls.length).toBe(0);
    expect((<Mock> fs.createWriteStream).mock.calls.length).toBe(0);
});
