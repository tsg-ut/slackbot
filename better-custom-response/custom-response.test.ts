import { vi, describe, it, expect, beforeEach } from 'vitest';
import moment from 'moment-timezone';
import customResponses from "./custom-responses.js";
import { increment } from "../achievements/index.js";

let store: Record<string, any> = {};

vi.mock('../achievements', () => {
    return {
        get: vi.fn(async (user: string, key: string) => store[`${user}:${key}`]),
        set: vi.fn(async (user: string, key: string, val: any) => {
            store[`${user}:${key}`] = val;
        }),
        increment: vi.fn(),
    };
});

describe('better-custom-response', () => {
    beforeEach(() => {
        store = {};
        vi.clearAllMocks();
    });

    it('either one of array and function', async () => {
        for (const customResponse of customResponses) {
            expect((customResponse.outputFunction !== undefined) !== (customResponse.outputArray !== undefined)).toBe(true);
        }
    });

    it('It Works! achievement logic works for kcztime', async () => {
        const kczResponse = customResponses.find(r => r.username === 'kcztime');
        expect(kczResponse).toBeDefined();

        const context = { user: 'U123456' };

        await kczResponse.outputFunction([], context);
        const time1 = store['U123456:bcr-kcztime-last-time'];
        expect(time1).toBeDefined();
        expect(increment).not.toHaveBeenCalled();

        const tomorrow = moment().add(1, 'day').format('YYYY-MM-DD HH:mm:ss');
        store['U123456:bcr-kcztime-last-time'] = tomorrow;

        await kczResponse.outputFunction([], context);
        expect(increment).toHaveBeenCalledWith('U123456', 'bcr-time-display-rewind');
    });

    it('It Works! achievement logic works for moratime', async () => {
        const moraResponse = customResponses.find(r => r.username === 'moratime');
        expect(moraResponse).toBeDefined();

        const context = { user: 'U123456' };

        await moraResponse.outputFunction([], context);
        const time1 = store['U123456:bcr-moratime-last-time'];
        expect(time1).toBeDefined();
        expect(increment).not.toHaveBeenCalled();

        const tomorrow = moment().add(1, 'day').format('YYYY-MM-DD HH:mm:ss');
        store['U123456:bcr-moratime-last-time'] = tomorrow;

        await moraResponse.outputFunction([], context);
        expect(increment).toHaveBeenCalledWith('U123456', 'bcr-time-display-rewind');
    });
});



