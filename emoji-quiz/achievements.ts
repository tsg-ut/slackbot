export const answerAchievements = [
	{pattern: /^sushi-/, counter: 'emoji-quiz-answer-sushi'},
	{pattern: /^robot-/, counter: 'emoji-quiz-answer-robot'},
	{pattern: /^taiko-/, counter: 'emoji-quiz-answer-taiko'},
	{pattern: /^(?:jre|jrw|toei|tokyo-metro)[-_][a-z_-]+$/, counter: 'emoji-quiz-answer-jr'},
	{pattern: /^[^\x00-\x7F]+$/u, counter: 'emoji-quiz-answer-unicode'},
	{pattern: /crying/, counter: 'emoji-quiz-answer-crying'},
];
