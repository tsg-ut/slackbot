// XXX: このファイルは CJS 形式のファイルから lib/state が require される場合のために存在するスタブ。
// lib/state.ts は Firestore など重い依存を持つため CJS 環境では直接ロードできず、
// Node の CJS ローダーが .ts 拡張子を解決できないことも相まって、この .js スタブが必要になっている。
// プロジェクトの ESM 化（または依存 CJS ファイルの TypeScript 化）完了後は必ずこのファイルを削除すること。(#846)

class State {
	static async init(name, defaultValues) {
		return Object.assign({}, defaultValues);
	}
}

module.exports = State;
module.exports.default = State;
