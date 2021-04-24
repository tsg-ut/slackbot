module.exports = {
	apps : [{
		name: 'app',
		interpreter: 'node',
		interpreter_args: '-r ts-node/register/transpile-only',
		script: 'index.ts',
		watch: false,
		min_uptime: '60s',
	}],
};
