/* eslint-env node, jest */

const axios = (options) => Promise.resolve(axios.response);
axios.get = axios;
axios.post = axios;

axios.response = '';

module.exports = axios;
