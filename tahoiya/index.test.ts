import {TahoiyaBot} from './TahoiyaBot';
import {normalizeMeaning, getPageTitle, getWordUrl} from './lib';

// Mock SlackMessageAdapter
const mockSlackMessageAdapter = {
	action: jest.fn(),
	viewSubmission: jest.fn(),
};

// Mock dependencies
const mockSlackInterface = {
	webClient: {
		users: {
			list: jest.fn().mockResolvedValue({members: []}),
		},
		team: {
			info: jest.fn().mockResolvedValue({team: {domain: 'test'}}),
		},
		chat: {
			postMessage: jest.fn().mockResolvedValue({ts: '123', channel: 'test'}),
		},
		views: {
			open: jest.fn().mockResolvedValue({}),
		},
	},
	eventClient: {
		on: jest.fn(),
	},
	messageClient: mockSlackMessageAdapter,
};

jest.mock('../lib/state', () => ({
	init: jest.fn().mockResolvedValue({
		phase: 'waiting',
		isWaitingDaily: false,
		author: null,
		authorHistory: [],
		candidates: [],
		meanings: new Map(),
		shuffledMeanings: [],
		bettings: new Map(),
		theme: null,
		ratings: new Map(),
		comments: [],
		stashedDaily: null,
		endThisPhase: null,
	}),
}));

jest.mock('sqlite', () => ({
	open: jest.fn().mockResolvedValue({
		get: jest.fn(),
		all: jest.fn(),
		run: jest.fn(),
	}),
}));

jest.mock('./lib', () => ({
	getCandidateWords: jest.fn().mockResolvedValue([]),
	getMeaning: jest.fn().mockResolvedValue('test meaning'),
	normalizeMeaning: jest.fn().mockImplementation((input) => input.trim()),
	getPageTitle: jest.fn().mockImplementation((url) => {
		if (url.startsWith('https://ja.wikipedia.org')) {
			return 'Test - Wikipedia';
		}
		return 'Test';
	}),
	getWordUrl: jest.fn().mockImplementation((word, source) => {
		if (source === 'wikipedia') {
			return `https://ja.wikipedia.org/wiki/${word}`;
		}
		return 'https://example.com';
	}),
	getIconUrl: jest.fn().mockReturnValue('https://example.com/icon.png'),
	getTimeLink: jest.fn().mockReturnValue('<https://example.com|12:00:00>'),
}));

describe('TahoiyaBot', () => {
	let bot: TahoiyaBot;

	beforeEach(() => {
		bot = new TahoiyaBot(mockSlackInterface as any);
	});

	describe('initialization', () => {
		it('should initialize without errors', async () => {
			await expect(bot.initialize()).resolves.not.toThrow();
		});
	});

	describe('getMemberName', () => {
		it('should return AI bot names correctly', () => {
			const bot = new TahoiyaBot(mockSlackInterface as any);
			expect((bot as any).getMemberName('tahoiyabot-01')).toBe('たほいやAIくん1号 (仮)');
			expect((bot as any).getMemberName('tahoiyabot-02')).toBe('たほいやAIくん2号 (仮)');
		});
	});

	describe('getMention', () => {
		it('should return proper mentions', () => {
			const bot = new TahoiyaBot(mockSlackInterface as any);
			expect((bot as any).getMention('U123456')).toBe('<@U123456>');
			expect((bot as any).getMention('tahoiyabot-01')).toBe('たほいやAIくん1号 (仮)');
		});
	});
});

describe('lib functions', () => {
	describe('normalizeMeaning', () => {
		it('should normalize meaning text correctly', () => {
			expect(normalizeMeaning('  test meaning  ')).toBe('test meaning');
		});
	});

	describe('getPageTitle', () => {
		it('should generate correct page titles', () => {
			expect(getPageTitle('https://ja.wikipedia.org/wiki/Test')).toBe('Test - Wikipedia');
		});
	});

	describe('getWordUrl', () => {
		it('should generate correct URLs', () => {
			expect(getWordUrl('test', 'wikipedia')).toBe('https://ja.wikipedia.org/wiki/test');
		});
	});
});

describe('Game flow', () => {
	it('should handle basic game initialization', async () => {
		const bot = new TahoiyaBot(mockSlackInterface as any);
		await bot.initialize();

		// Test that the bot is in waiting state initially
		expect((bot as any).state.phase).toBe('waiting');
	});
});
