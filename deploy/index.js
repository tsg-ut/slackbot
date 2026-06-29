// XXX: このファイルは mahjong/index.js (CJS) が require('../deploy/index') でロードするために存在するスタブ。
// mahjong/index.js は CJS 形式のため Vite のモジュール解決をバイパスし、Node の CJS ローダーが
// .ts 拡張子を解決できないので、deploy/index.ts の代わりにこの .js スタブが必要になっている。
// プロジェクトの ESM 化（または mahjong/index.js の TypeScript 化）完了後は必ずこのファイルを削除すること。(#846)

const blockDeploy = async () => {};

module.exports = {blockDeploy};
module.exports.default = module.exports;
