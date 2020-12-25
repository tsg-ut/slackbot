/* eslint-env node, jest */

const sqlite = jest.genMockFromModule('sqlite');

sqlite.open = jest.fn(() => ({
  all: jest.fn(() => Promise.resolve(sqlite.records)),
  get: jest.fn(() => Promise.resolve(sqlite.records.length >= 1 ? sqlite.records[0] : null)),
}));

sqlite.records = [];

module.exports = sqlite;
