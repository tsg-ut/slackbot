import {vi} from 'vitest';

const mockCollection = vi.fn(() => ({
	add: vi.fn(),
	doc: vi.fn(() => ({
		get: vi.fn(),
		set: vi.fn(),
		update: vi.fn(),
		delete: vi.fn(),
	})),
	where: vi.fn(),
	orderBy: vi.fn(),
	limit: vi.fn(),
	get: vi.fn(),
}));

const db = {
	collection: mockCollection,
};

export default db;
