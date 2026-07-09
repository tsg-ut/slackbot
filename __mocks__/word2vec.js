class Model {
	similarity() {
		return 0;
	}

	getVector() {
		return Array(100).fill(0);
	}
}

export const loadModel = vi.fn((params, done) => {
	done(null, new Model());
});

export default {loadModel};
