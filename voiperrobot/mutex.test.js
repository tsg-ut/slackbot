"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mutex_1 = __importDefault(require("./mutex"));
const waitNextTick = () => new Promise((resolve) => {
    process.nextTick(resolve);
});
describe('voiperrobot/mutex', () => {
    it('runs serial critical sections in order', async () => {
        const executed = [];
        const mutex = new mutex_1.default();
        await mutex.exec(async () => {
            executed.push('a');
            await waitNextTick();
            executed.push('b');
        });
        await mutex.exec(async () => {
            executed.push('c');
            await waitNextTick();
            executed.push('d');
        });
        await mutex.exec(async () => {
            executed.push('e');
            await waitNextTick();
            executed.push('f');
        });
        expect(executed).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    });
    it('runs critical sections mutually exclusively (1)', async () => {
        const executed = [];
        const mutex = new mutex_1.default();
        await Promise.all([
            mutex.exec(async () => {
                executed.push('a');
                await waitNextTick();
                executed.push('b');
            }),
            mutex.exec(async () => {
                executed.push('c');
                await waitNextTick();
                executed.push('d');
            }),
            mutex.exec(async () => {
                executed.push('e');
                await waitNextTick();
                executed.push('f');
            }),
        ]);
        expect(executed).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    });
    it('runs critical sections mutually exclusively (2)', async () => {
        const executed = [];
        const promises = [];
        const mutex = new mutex_1.default();
        await mutex.exec(async () => {
            executed.push('a');
            promises.push(mutex.exec(async () => {
                executed.push('c');
                await waitNextTick();
                executed.push('d');
            }));
            await waitNextTick();
            executed.push('b');
        });
        expect(promises).toHaveLength(1);
        await Promise.all(promises);
        expect(executed).toEqual(['a', 'b', 'c', 'd']);
    });
    it('unlocks when an error occurred in critical sections', async () => {
        const executed = [];
        const mutex = new mutex_1.default();
        const promise1 = mutex.exec(async () => {
            executed.push('a');
            await waitNextTick();
            executed.push('b');
            throw "some error";
        });
        const promise2 = mutex.exec(async () => {
            executed.push('c');
            await waitNextTick();
            executed.push('d');
            return "some result";
        });
        await expect(promise1).rejects.toBe("some error");
        await expect(promise2).resolves.toBe("some result");
        expect(executed).toEqual(['a', 'b', 'c', 'd']);
    });
});
