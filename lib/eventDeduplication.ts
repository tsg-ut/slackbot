import { createClient, RedisClientType } from 'redis';
import logger from './logger';
import { Mutex } from 'async-mutex';

const log = logger.child({ bot: 'eventDeduplication' });

interface DuplicateEventChecker {
	constructor(redisUrl: string): void;
	isEventProcessed: (eventId: string) => Promise<boolean>;
	markEventAsProcessed: (eventId: string) => Promise<void>;
	close: () => Promise<void>;
}

class RedisDuplicateEventChecker implements DuplicateEventChecker {
	#client: RedisClientType;
	#connected = false;
	#url: string;
	#mutex: Mutex;

	constructor(url: string) {
		this.#url = url;

		this.#client = createClient({
			url,
		});

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

	private async ensureConnected(): Promise<void> {
		await this.#mutex.runExclusive(async () => {
			if (!this.#connected) {
				await this.#client.connect();
			}
		});
	}

	async isEventProcessed(eventId: string): Promise<boolean> {
		try {
			await this.ensureConnected();
			const key = `slack:event:${eventId}`;
			const exists = await this.#client.exists(key);
			return exists === 1;
		} catch (error) {
			log.error('Failed to check if event is processed', { eventId, error });
			return false;
		}
	}

	async markEventAsProcessed(eventId: string): Promise<void> {
		try {
			await this.ensureConnected();
			const key = `slack:event:${eventId}`;
			await this.#client.setEx(key, 300, 'processed');
		} catch (error) {
			log.error('Failed to mark event as processed', { eventId, error });
		}
	}

	async close(): Promise<void> {
		if (this.#connected) {
			await this.#client.quit();
		}
	}
}

class NoOpDuplicateEventChecker implements DuplicateEventChecker {
	async isEventProcessed(_eventId: string): Promise<boolean> {
		return false; // 常に未処理として処理
	}

	async markEventAsProcessed(_eventId: string): Promise<void> {
		// 何もしない
	}

	async close(): Promise<void> {
		// 何もしない
	}
}

// Singleton
let duplicateEventChecker: DuplicateEventChecker | null = null;
export const getDuplicateEventChecker = (): DuplicateEventChecker => {
	if (!duplicateEventChecker) {
		if (process.env.REDIS_URL && process.env.REDIS_URL.trim() !== '') {
			log.info('Using Redis for event deduplication');
			duplicateEventChecker = new RedisDuplicateEventChecker(process.env.REDIS_URL);
		} else {
			log.info('REDIS_URL not configured, event deduplication is disabled');
			duplicateEventChecker = new NoOpDuplicateEventChecker();
		}
	}
	return duplicateEventChecker;
};

export const closeDuplicateEventChecker = async (): Promise<void> => {
	if (duplicateEventChecker) {
		await duplicateEventChecker.close();
		duplicateEventChecker = null;
	}
};
