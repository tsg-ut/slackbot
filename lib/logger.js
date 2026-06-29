const logger = {
	child: function() { return logger; },
	debug: function() {},
	info: function() {},
	warn: function() {},
	error: function() {},
	trace: function() {},
	fatal: function() {},
	http: function() {},
	verbose: function() {},
	silly: function() {},
	silent: function() {},
};

module.exports = logger;
module.exports.default = logger;
