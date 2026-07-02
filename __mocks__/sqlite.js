const sqlite = {};

sqlite.open = vi.fn(() => ({
  all: vi.fn(() => Promise.resolve(sqlite.records)),
  get: vi.fn(() => Promise.resolve(sqlite.records.length >= 1 ? sqlite.records[0] : null)),
}));

sqlite.records = [];

module.exports = sqlite;
