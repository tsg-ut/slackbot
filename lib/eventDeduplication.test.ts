import { getDuplicateEventChecker, closeDuplicateEventChecker } from '../lib/eventDeduplication';

describe('Event Deduplication', () => {
	let originalRedisUrl: string | undefined;

	beforeEach(() => {
		originalRedisUrl = process.env.REDIS_URL;
	});

	afterEach(async () => {
		await closeDuplicateEventChecker();
		if (originalRedisUrl !== undefined) {
			process.env.REDIS_URL = originalRedisUrl;
		} else {
			delete process.env.REDIS_URL;
		}
	});

	describe('NoOp implementation (no REDIS_URL)', () => {
		beforeEach(() => {
			delete process.env.REDIS_URL;
		});

		it('should always return false for isEventProcessed', async () => {
			const checker = getDuplicateEventChecker();
			const eventId = 'test-event-123';

			await checker.markEventAsProcessed(eventId);
			expect(await checker.isEventProcessed(eventId)).toBe(false);
		});
	});

	describe('NoOp implementation (empty REDIS_URL)', () => {
		beforeEach(() => {
			process.env.REDIS_URL = '';
		});

		it('should always return false for isEventProcessed with empty string', async () => {
			const checker = getDuplicateEventChecker();
			const eventId = 'test-event-123';

			await checker.markEventAsProcessed(eventId);
			expect(await checker.isEventProcessed(eventId)).toBe(false);
		});
	});

	describe('Redis implementation', () => {
		beforeEach(() => {
			process.env.REDIS_URL = 'redis://localhost:6379';
		});

		it('should create Redis client when REDIS_URL is set', () => {
			const checker = getDuplicateEventChecker();
			expect(checker).toBeDefined();
		});
	});
});
