module.exports = {
	apps : [{
		name: 'app',
		interpreter: 'node',
		interpreter_args: '-r ts-node/register/transpile-only --max_old_space_size=8192',
		script: 'index.ts',
		watch: false,
		min_uptime: '60s',
	}],
};
