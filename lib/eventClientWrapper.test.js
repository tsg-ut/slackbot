"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const eventClientWrapper_1 = require("./eventClientWrapper");
const eventDeduplication_1 = require("./eventDeduplication");
const events_api_1 = require("@slack/events-api");
const promises_1 = require("timers/promises");
jest.mock('./eventDeduplication');
const mockedGetDuplicateEventChecker = jest.mocked(eventDeduplication_1.getDuplicateEventChecker);
const mockedDuplicateEventCheckerPrototype = jest.mocked(eventDeduplication_1.DuplicateEventChecker.prototype);
describe('EventClientWrapper', () => {
    let eventAdapter;
    let wrapper;
    beforeEach(() => {
        eventAdapter = (0, events_api_1.createEventAdapter)('test-signing-secret', { includeBody: true });
        wrapper = new eventClientWrapper_1.EventClientWrapper(eventAdapter);
        mockedGetDuplicateEventChecker.mockReturnValue(new eventDeduplication_1.DuplicateEventChecker(null));
    });
    afterEach(() => {
        jest.clearAllMocks();
    });
    it('should forward non-duplicate events', async () => {
        const listener = jest.fn();
        mockedDuplicateEventCheckerPrototype.markEventAsProcessed.mockResolvedValue(false);
        wrapper.on('test_event', listener);
        const eventData = { event_id: 'test-event-id', team_id: 'test-team' };
        eventAdapter.emit('test_event', {}, eventData);
        // Give async operations time to complete
        await (0, promises_1.setImmediate)();
        expect(listener).toHaveBeenCalledWith({}, eventData);
        expect(mockedDuplicateEventCheckerPrototype.markEventAsProcessed).toHaveBeenCalledWith('test-event-id');
    });
    it('should block duplicate events', async () => {
        const listener = jest.fn();
        mockedDuplicateEventCheckerPrototype.markEventAsProcessed.mockResolvedValue(true);
        wrapper.on('test_event', listener);
        const eventData = { event_id: 'test-event-id', team_id: 'test-team' };
        eventAdapter.emit('test_event', {}, eventData);
        // Give async operations time to complete
        await (0, promises_1.setImmediate)();
        expect(listener).not.toHaveBeenCalled();
        expect(mockedDuplicateEventCheckerPrototype.markEventAsProcessed).toHaveBeenCalledWith('test-event-id');
    });
    it('should handle events without event_id', async () => {
        const listener = jest.fn();
        wrapper.on('test_event', listener);
        const eventData = { team_id: 'test-team' };
        eventAdapter.emit('test_event', {}, eventData);
        // Give async operations time to complete
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(listener).toHaveBeenCalledWith({}, eventData);
        expect(mockedDuplicateEventCheckerPrototype.markEventAsProcessed).not.toHaveBeenCalled();
    });
    it('should handle multiple listeners for the same event with single deduplication check', async () => {
        const listener1 = jest.fn();
        const listener2 = jest.fn();
        mockedDuplicateEventCheckerPrototype.markEventAsProcessed.mockResolvedValue(false);
        wrapper.on('test_event', listener1);
        wrapper.on('test_event', listener2);
        const eventData = { event_id: 'test-event-id', team_id: 'test-team' };
        eventAdapter.emit('test_event', {}, eventData);
        // Give async operations time to complete
        await (0, promises_1.setImmediate)();
        expect(listener1).toHaveBeenCalledWith({}, eventData);
        expect(listener2).toHaveBeenCalledWith({}, eventData);
        expect(mockedDuplicateEventCheckerPrototype.markEventAsProcessed).toHaveBeenCalledTimes(1);
    });
    it('should block duplicate events for all listeners', async () => {
        const listener1 = jest.fn();
        const listener2 = jest.fn();
        mockedDuplicateEventCheckerPrototype.markEventAsProcessed.mockResolvedValue(true);
        wrapper.on('test_event', listener1);
        wrapper.on('test_event', listener2);
        const eventData = { event_id: 'test-event-id', team_id: 'test-team' };
        eventAdapter.emit('test_event', {}, eventData);
        // Give async operations time to complete
        await (0, promises_1.setImmediate)();
        expect(listener1).not.toHaveBeenCalled();
        expect(listener2).not.toHaveBeenCalled();
        expect(mockedDuplicateEventCheckerPrototype.markEventAsProcessed).toHaveBeenCalledTimes(1);
    });
});
