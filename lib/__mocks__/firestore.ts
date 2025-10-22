const mockCollection = jest.fn(() => ({
	add: jest.fn(),
	doc: jest.fn(() => ({
		get: jest.fn(),
		set: jest.fn(),
		update: jest.fn(),
		delete: jest.fn(),
	})),
	where: jest.fn(),
	orderBy: jest.fn(),
	limit: jest.fn(),
	get: jest.fn(),
}));

const db = {
	collection: mockCollection,
};

export default db;
