
class Model {
	similarity() {
		return 0;
	}

	getVector() {
		return Array(100).fill(0);
	}
}

module.exports.loadModel = vi.fn((params, done) => {
	done(null, new Model());
});
