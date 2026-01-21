"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventClientWrapper = void 0;
const eventDeduplication_1 = require("./eventDeduplication");
const logger_1 = __importDefault(require("./logger"));
const events_1 = require("events");
const log = logger_1.default.child({ bot: 'EventClientWrapper' });
// Slackのイベント重複除去を行うEventClientのラッパー
class EventClientWrapper extends events_1.EventEmitter {
    #eventAdapter;
    #registeredEvents = new Set();
    expressMiddleware;
    constructor(eventAdapter) {
        super();
        this.#eventAdapter = eventAdapter;
        this.expressMiddleware = this.#eventAdapter.expressMiddleware.bind(this.#eventAdapter);
    }
    setupEventHandler(event) {
        if (this.#registeredEvents.has(event)) {
            return;
        }
        this.#registeredEvents.add(event);
        this.#eventAdapter.on(event, async (...args) => {
            const [, eventBody] = args;
            const eventId = eventBody?.event_id;
            if (eventId) {
                const duplicateChecker = (0, eventDeduplication_1.getDuplicateEventChecker)();
                const wasAlreadyProcessed = await duplicateChecker.markEventAsProcessed(eventId);
                if (wasAlreadyProcessed) {
                    log.debug(`Duplicate event detected (id: ${eventId}), skipping`, { eventId, event });
                    return;
                }
            }
            else {
                log.warn('Event without event_id received', { event, teamId: eventBody.team_id });
            }
            // Emit the event to our own listeners after deduplication
            this.emit(event, ...args);
        });
    }
    on(event, listener) {
        this.setupEventHandler(event);
        return super.on(event, listener);
    }
    addListener(event, listener) {
        return this.on(event, listener);
    }
    once(event, listener) {
        this.setupEventHandler(event);
        return super.once(event, listener);
    }
    prependListener(event, listener) {
        this.setupEventHandler(event);
        return super.prependListener(event, listener);
    }
    prependOnceListener(event, listener) {
        this.setupEventHandler(event);
        return super.prependOnceListener(event, listener);
    }
}
exports.EventClientWrapper = EventClientWrapper;
