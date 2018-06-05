/* eslint-env node, jest */

const axios = (options) => Promise.resolve(axios.response);

axios.response = '';

module.exports = axios;
