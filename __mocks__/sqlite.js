const sqlite = {};

sqlite.open = vi.fn(() => ({
  all: vi.fn(() => Promise.resolve(sqlite.records)),
  // 実際の sqlite/sqlite3 driver は該当行が無い場合 undefined を返す(null ではない)。
  get: vi.fn(() => Promise.resolve(sqlite.records.length >= 1 ? sqlite.records[0] : undefined)),
  run: vi.fn(() => Promise.resolve()),
  close: vi.fn(() => Promise.resolve()),
}));

sqlite.records = [];

module.exports = sqlite;
