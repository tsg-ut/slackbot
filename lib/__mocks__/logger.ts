import {vi} from 'vitest';

const createLoggerStub = () => ({
	fatal: vi.fn(),
	error: vi.fn(),
	warn: vi.fn(),
	info: vi.fn(),
	http: vi.fn(),
	verbose: vi.fn(),
	debug: vi.fn(),
	silly: vi.fn(),
	trace: vi.fn(),
	silent: vi.fn(),
	child: () => createLoggerStub(),
});

export default createLoggerStub();
