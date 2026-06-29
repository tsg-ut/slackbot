class State {
	static async init(name, defaultValues) {
		return Object.assign({}, defaultValues);
	}
}

module.exports = State;
module.exports.default = State;
