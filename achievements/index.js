/* eslint-disable global-require */

if (process.env.NODE_ENV === 'production') {
	module.exports = require('./index_production.ts');
} else {
	module.exports = require('./index_development.ts');
}
