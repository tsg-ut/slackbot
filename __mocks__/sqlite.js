/* eslint-env node, jest */

const sqlite = jest.genMockFromModule('sqlite');

sqlite.all = (sql, variables) => Promise.resolve(sqlite.records);
sqlite.get = (sql, variables) => Promise.resolve(sqlite.records.length >= 1 ? sqlite.records[0] : null);

sqlite.records = [];

module.exports = sqlite;
