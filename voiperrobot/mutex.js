"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class Mutex {
    locked = false;
    resolves = [];
    lock() {
        const promise = new Promise((resolve) => {
            this.resolves.push(resolve);
        });
        this.execNext();
        return promise;
    }
    async exec(proc) {
        const unlock = await this.lock();
        try {
            return await proc();
        }
        finally {
            unlock();
        }
    }
    execNext() {
        if (this.locked) {
            return;
        }
        if (this.resolves.length === 0) {
            return;
        }
        this.locked = true;
        const resolve = this.resolves.shift();
        let unlocked = false;
        const unlock = () => {
            if (unlocked) {
                return;
            }
            this.locked = false;
            unlocked = true;
            this.execNext();
        };
        resolve(unlock);
    }
}
exports.default = Mutex;
