/* eslint-env node, jest */

const sqlite = jest.genMockFromModule('sqlite');

sqlite.open = jest.fn(() => ({
  all: jest.fn(() => Promise.resolve(sqlite.records)),
  // 実際の sqlite/sqlite3 driver は該当行が無い場合 undefined を返す(null ではない)。
  get: jest.fn(() => Promise.resolve(sqlite.records.length >= 1 ? sqlite.records[0] : undefined)),
  run: jest.fn(() => Promise.resolve()),
  close: jest.fn(() => Promise.resolve()),
}));

sqlite.records = [];

module.exports = sqlite;
