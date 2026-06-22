/* eslint-env node, jest */

const download = jest.fn((options) => Promise.resolve(download.response));
download.get = download;
download.post = download;

download.response = '';

module.exports = download;
