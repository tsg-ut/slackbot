const download = vi.fn((options) => Promise.resolve(download.response));
download.get = download;
download.post = download;

download.response = '';

export default download;
