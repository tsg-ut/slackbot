import {
	getDuplicateEventChecker,
	closeDuplicateEventChecker,
} from './eventDeduplication';
import { createClient } from 'redis';

const mockRedis: Pick<
	jest.Mocked<ReturnType<typeof createClient>>,
	'set' | 'connect' | 'quit' | 'on'
> = {
	set: jest.fn(),
	connect: jest.fn(),
	quit: jest.fn(),
	on: jest.fn(),
};

jest.mock('redis', () => ({
	createClient: jest.fn(() => mockRedis),
}));

const mockedCreateClient = jest.mocked(createClient);

describe('Event Deduplication', () => {
	let originalRedisUrl: string | undefined;

	beforeEach(() => {
		originalRedisUrl = process.env.REDIS_URL;
		jest.clearAllMocks();
	});

	afterEach(async () => {
		await closeDuplicateEventChecker();
		if (originalRedisUrl !== undefined) {
			process.env.REDIS_URL = originalRedisUrl;
		} else {
			delete process.env.REDIS_URL;
		}
	});

	describe('No REDIS_URL', () => {
		beforeEach(() => {
			delete process.env.REDIS_URL;
		});

		it('should always return false for isEventProcessed', async () => {
			const checker = getDuplicateEventChecker();
			const eventId = 'test-event-123';

			await checker.markEventAsProcessed(eventId);
			expect(await checker.markEventAsProcessed(eventId)).toBe(false);
		});
	});

	describe('Redis implementation', () => {
		beforeEach(() => {
			process.env.REDIS_URL = 'redis://localhost:6379';
			mockRedis.connect.mockResolvedValue(undefined);
			mockRedis.set.mockResolvedValue('OK');
			mockRedis.quit.mockResolvedValue(undefined);
		});

		it('should create Redis client when REDIS_URL is set', () => {
			const checker = getDuplicateEventChecker();
			expect(checker).toBeDefined();

			expect(mockedCreateClient).toHaveBeenCalledWith({
				url: 'redis://localhost:6379',
			});
		});

		it('should return false for new event (not processed)', async () => {
			mockRedis.set.mockResolvedValue('OK'); // Key was set successfully (new event)

			const checker = getDuplicateEventChecker();
			const eventId = 'test-event-123';

			const result = await checker.markEventAsProcessed(eventId);

			expect(result).toBe(false);
			expect(mockRedis.connect).toHaveBeenCalled();
			expect(mockRedis.set).toHaveBeenCalledWith(
				'slack:event:test-event-123',
				'processed',
				{ condition: 'NX', expiration: { type: 'EX', value: 300 } }
			);
		});

		it('should return true for already processed event', async () => {
			mockRedis.set.mockResolvedValue(null); // Key already exists (duplicate event)

			const checker = getDuplicateEventChecker();
			const eventId = 'test-event-456';

			const result = await checker.markEventAsProcessed(eventId);

			expect(result).toBe(true);
			expect(mockRedis.connect).toHaveBeenCalled();
			expect(mockRedis.set).toHaveBeenCalledWith(
				'slack:event:test-event-456',
				'processed',
				{ condition: 'NX', expiration: { type: 'EX', value: 300 } }
			);
		});

		it('should mark event as processed', async () => {
			const checker = getDuplicateEventChecker();
			const eventId = 'test-event-789';

			await checker.markEventAsProcessed(eventId);

			expect(mockRedis.connect).toHaveBeenCalled();
			expect(mockRedis.set).toHaveBeenCalledWith(
				'slack:event:test-event-789',
				'processed',
				{ condition: 'NX', expiration: { type: 'EX', value: 300 } }
			);
		});

		it('should handle Redis connection errors gracefully when marking event', async () => {
			mockRedis.set.mockRejectedValue(new Error());

			const checker = getDuplicateEventChecker();
			const eventId = 'test-event-error';

			await checker.markEventAsProcessed(eventId);
			expect(mockRedis.set).toHaveBeenCalledWith(
				'slack:event:test-event-error',
				'processed',
				{ condition: 'NX', expiration: { type: 'EX', value: 300 } }
			);
		});

		it('should close Redis connection properly', async () => {
			const checker = getDuplicateEventChecker();

			const connectHandler = mockRedis.on.mock.calls.find(
				(call) => call[0] === 'connect'
			);
			if (connectHandler) {
				connectHandler[1]();
			}

			await checker.close();

			expect(mockRedis.quit).toHaveBeenCalled();
		});

		it('should handle duplicate event scenario', async () => {
			const checker = getDuplicateEventChecker();
			const eventId = 'duplicate-event-123';

			mockRedis.set.mockResolvedValueOnce('OK'); // First time: key was set
			expect(await checker.markEventAsProcessed(eventId)).toBe(false);

			mockRedis.set.mockResolvedValueOnce(null); // Second time: key already exists
			expect(await checker.markEventAsProcessed(eventId)).toBe(true);

			expect(mockRedis.set).toHaveBeenCalledTimes(2);
			expect(mockRedis.set).toHaveBeenCalledWith(
				'slack:event:duplicate-event-123',
				'processed',
				{ condition: 'NX', expiration: { type: 'EX', value: 300 } }
			);
		});

		it('should set up proper Redis event handlers', () => {
			getDuplicateEventChecker();

			expect(mockRedis.on).toHaveBeenCalledWith('error', expect.any(Function));
			expect(mockRedis.on).toHaveBeenCalledWith(
				'connect',
				expect.any(Function)
			);
			expect(mockRedis.on).toHaveBeenCalledWith(
				'disconnect',
				expect.any(Function)
			);
		});
	});

	describe('Singleton behavior', () => {
		it('should reuse the same checker instance (singleton pattern)', () => {
			const checker1 = getDuplicateEventChecker();
			const checker2 = getDuplicateEventChecker();

			expect(checker1).toBe(checker2);
		});

		it('should create new instance after closing and changing configuration', async () => {
			const checker1 = getDuplicateEventChecker();

			await closeDuplicateEventChecker();

			const checker2 = getDuplicateEventChecker();

			expect(checker1).not.toBe(checker2);
		});
	});
});
