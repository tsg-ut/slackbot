class AteQuiz {
	constructor(slack, problem, options) {
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

const typicalMessageTextsGenerator = {};

module.exports = {AteQuiz, typicalAteQuizHintTexts, typicalMessageTextsGenerator};
module.exports.default = module.exports;
