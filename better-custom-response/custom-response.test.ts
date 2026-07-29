import { vi, describe, it, expect, beforeEach } from 'vitest';
import customResponses from "./custom-responses";
import { get, increment } from "../achievements";

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

    it('It Works! achievement logic works', async () => {
        const kczResponse = customResponses.find(r => r.username === 'kcztime');
        const moraResponse = customResponses.find(r => r.username === 'moratime');

        expect(kczResponse).toBeDefined();
        expect(moraResponse).toBeDefined();

        const context = { user: 'U123456' };

        // 1. Initial query to Cambridge (Europe/London)
        await moraResponse.outputFunction([], context);

        // check that last time is saved
        const time1 = store['U123456:kcz-mora-last-time'];
        expect(time1).toBeDefined();
        expect(increment).not.toHaveBeenCalled();

        // 2. Query to Boston (America/New_York)
        // Since Boston local time is 5 hours behind London local time,
        // even with a tiny delay, Boston local time is earlier than the previously saved time1.
        await kczResponse.outputFunction([], context);

        const time2 = store['U123456:kcz-mora-last-time'];
        expect(time2).toBeDefined();
        expect(time2 < time1).toBe(true);

        // increment should have been called to unlock it-works
        expect(increment).toHaveBeenCalledWith('U123456', 'it-works');
    });
});

