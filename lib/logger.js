// XXX: このファイルは hangman/index.js・summary/index.js・summary/summary_writer.js (CJS) が
// require('../lib/logger') でロードするために存在するスタブ。
// これらのファイルは CJS 形式のため Vite のモジュール解決をバイパスし、Node の CJS ローダーが
// .ts 拡張子を解決できないので、lib/logger.ts の代わりにこの .js スタブが必要になっている。
// プロジェクトの ESM 化（または各 CJS ファイルの TypeScript 化）完了後は必ずこのファイルを削除すること。

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
