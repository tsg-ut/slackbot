// XXX: このファイルは mahjong/index.js (CJS) がテスト環境で require('../atequiz/index') でロードするために存在するスタブ。
// mahjong/index.js は CJS 形式のため Vite のモジュール解決をバイパスし、Node の CJS ローダーが
// .ts 拡張子を解決できないので、atequiz/index.ts の代わりにこの .js スタブが必要になっている。
// プロジェクトの ESM 化（または mahjong/index.js の TypeScript 化）完了後は必ずこのファイルを削除すること。(#846)

class AteQuiz {
	constructor(slack, problem, options) {
		this.slack = (slack && slack.webClient) || slack;
		this.eventClient = slack && slack.eventClient;
		this.problem = problem;
	}

	start() {
		return Promise.resolve({
			state: 'unsolved',
			quiz: this.problem,
			hintIndex: null,
			correctAnswerer: null,
		});
	}
}

const typicalAteQuizHintTexts = [];

const typicalMessageTextsGenerator = {
	problem: (genre) => `この${genre}なーんだ`,
	immediate: () => '15秒経過でヒントを出すよ♫',
	solved: (answer) => `<@[[!user]]> 正解:tada:\n答えは${answer}だよ:muscle:`,
	unsolved: (answer) => `もう、しっかりして！\n答えは${answer}だよ:anger:`,
};

module.exports = {AteQuiz, typicalAteQuizHintTexts, typicalMessageTextsGenerator};
module.exports.default = module.exports;
