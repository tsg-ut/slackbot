import achievements from '../achievements/achievements';

describe('emoji-quiz achievements', () => {
	it.each([
		['ちょっとエモい', 'emoji-quiz-easy-answer', 1],
		['エモい', 'emoji-quiz-normal-answer', 1],
		['とてもエモい', 'emoji-quiz-answer', 10],
		['本当にエモい', 'emoji-quiz-answer', 100],
		['超エモい', 'emoji-quiz-answer', 1000],
		['SUSHI食べたい', 'emoji-quiz-answer-sushi', 1],
		['Bot Detected', 'emoji-quiz-answer-robot', 1],
		['譜面覚えゲー', 'emoji-quiz-answer-taiko', 1],
		['人間CDN', 'emoji-quiz-answer-within-5s', 1],
	])('defines %s with the expected progress counter and threshold', (title, counter, value) => {
		const achievement = Array.from(achievements.values()).find((entry) => entry.title === title);
		expect(achievement).toMatchObject({counter, value, category: 'emoji-quiz'});
	});
});
