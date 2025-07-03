import {createClient, RedisClientType} from 'redis';
import logger from './logger.js';
import {Mutex} from 'async-mutex';

const log = logger.child({bot: 'eventDeduplication'});

class DuplicateEventChecker {
	#client: RedisClientType | null = null;
	#connected = false;
	#mutex: Mutex = new Mutex();

	constructor(url: string | null) {
		if (url === null) {
			log.info('No Redis URL provided, event deduplication will be disabled');
			return;
		}

		this.#client = createClient({url});

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
		if (this.#client === null) {
			return;
		}

		await this.#mutex.runExclusive(async () => {
			if (!this.#connected) {
				await this.#client.connect();
			}
		});
	}

	async markEventAsProcessed(eventId: string): Promise<boolean> {
		if (this.#client === null) {
			return false;
		}

		try {
			await this.ensureConnected();
			const key = `slack:event:${eventId}`;
			const wasAlreadyProcessed = await this.#mutex.runExclusive(async () => {
				const exists = await this.#client.exists(key);
				const isProcessed = exists === 1;
				if (!isProcessed) {
					await this.#client.setEx(key, 300, 'processed');
				}
				return isProcessed;
			});
			return wasAlreadyProcessed;
		} catch (error) {
			log.error('Failed to mark event as processed', { eventId, error });
			return false;
		}
	}

	async close(): Promise<void> {
		if (this.#connected) {
			await this.#client?.quit();
		}
	}
}

// Singleton
let duplicateEventChecker: DuplicateEventChecker | null = null;
export const getDuplicateEventChecker = (): DuplicateEventChecker => {
	if (duplicateEventChecker === null) {
		let redisUrl = process.env.REDIS_URL?.trim();
		if (redisUrl && redisUrl !== '') {
			log.info('Using Redis for event deduplication');
		} else {
			log.info('REDIS_URL not configured, event deduplication is disabled');
			redisUrl = null;
		}

		duplicateEventChecker = new DuplicateEventChecker(redisUrl);
	}

	return duplicateEventChecker;
};

export const closeDuplicateEventChecker = async (): Promise<void> => {
	if (duplicateEventChecker !== null) {
		await duplicateEventChecker.close();
		duplicateEventChecker = null;
	}
};
