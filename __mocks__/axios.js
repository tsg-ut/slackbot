const {PassThrough} = require('stream');

const axios = vi.fn((urlOrConfig = {}, config = {}) => {
	// axios.get(url, config) / axios.post(url, data, config) のように、第一引数が
	// URL文字列で呼ばれるケースと、axios(config) のように設定オブジェクト単体で
	// 呼ばれるケースの両方に対応する。
	const options = typeof urlOrConfig === 'string' ? config : urlOrConfig;
	if (options.responseType === 'stream') {
		const stream = new PassThrough();
		process.nextTick(() => {
			stream.end(axios.response);
		});
		return Promise.resolve({data: stream});
	}

	return Promise.resolve(axios.response);
});
axios.get = axios;
axios.post = axios;
axios.head = axios;

axios.response = '';

// axios.create() で作られたインスタンスは axios.defaults.* を直接
// 読み書きできる必要がある(例: clientCH.defaults.withCredentials = false)。
axios.defaults = {
	headers: {
		post: {},
		common: {},
	},
};

// axios.create() はconfigをbindした新しいaxiosインスタンスを返すのが実際の
// 挙動だが、このモックでは単純に同じモックを返す。
axios.create = () => axios;

axios.default = {
	defaults: {},
};

module.exports = axios;
