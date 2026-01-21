"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.closeDuplicateEventChecker = exports.getDuplicateEventChecker = exports.DuplicateEventChecker = void 0;
const redis_1 = require("redis");
const logger_1 = __importDefault(require("./logger"));
const async_mutex_1 = require("async-mutex");
const log = logger_1.default.child({ bot: 'eventDeduplication' });
class DuplicateEventChecker {
    #client = null;
    #connected = false;
    #mutex = new async_mutex_1.Mutex();
    constructor(url) {
        if (url === null) {
            log.info('No Redis URL provided, event deduplication will be disabled');
            return;
        }
        this.#client = (0, redis_1.createClient)({ url });
        this.#client.on('error', (err) => {
            log.error('Redis Client Error', err);
        });
        this.#client.on('connect', () => {
            log.info('Redis Client Connected');
            this.#connected = true;
        });
        this.#client.on('disconnect', () => {
            log.warn('Redis Client Disconnected');
            this.#connected = false;
        });
    }
    async ensureConnected() {
        if (this.#client === null) {
            return;
        }
        await this.#mutex.runExclusive(async () => {
            if (!this.#connected) {
                await this.#client.connect();
            }
        });
    }
    async markEventAsProcessed(eventId) {
        if (this.#client === null) {
            return false;
        }
        try {
            await this.ensureConnected();
            const key = `slack:event:${eventId}`;
            const wasAlreadyProcessed = await this.#mutex.runExclusive(async () => {
                // Returns 'OK' if key was set (first time), null if key already exists
                const result = await this.#client.set(key, 'processed', {
                    condition: 'NX', // Only set if not exists
                    expiration: {
                        type: 'EX',
                        value: 300, // 5 minutes
                    },
                });
                return result === null;
            });
            return wasAlreadyProcessed;
        }
        catch (error) {
            log.error('Failed to mark event as processed', { eventId, error });
            return false;
        }
    }
    async close() {
        if (this.#connected) {
            await this.#client?.quit();
        }
    }
}
exports.DuplicateEventChecker = DuplicateEventChecker;
// Singleton
let duplicateEventChecker = null;
const getDuplicateEventChecker = () => {
    if (duplicateEventChecker === null) {
        let redisUrl = process.env.REDIS_URL?.trim();
        if (redisUrl && redisUrl !== '') {
            log.info('Using Redis for event deduplication');
        }
        else {
            log.info('REDIS_URL not configured, event deduplication is disabled');
            redisUrl = null;
        }
        duplicateEventChecker = new DuplicateEventChecker(redisUrl);
    }
    return duplicateEventChecker;
};
exports.getDuplicateEventChecker = getDuplicateEventChecker;
const closeDuplicateEventChecker = async () => {
    if (duplicateEventChecker !== null) {
        await duplicateEventChecker.close();
        duplicateEventChecker = null;
    }
};
exports.closeDuplicateEventChecker = closeDuplicateEventChecker;
