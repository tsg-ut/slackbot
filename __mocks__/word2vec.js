/* eslint-env node, jest */

class Model {
	similarity() {
		return 0;
	}

	getVector() {
		return Array(100).fill(0);
	}
}

module.exports.loadModel = jest.fn((params, done) => {
	done(null, new Model());
});
