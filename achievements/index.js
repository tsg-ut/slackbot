/* eslint-disable global-require */

if (process.env.NODE_ENV === 'production') {
	module.exports = require('./index_production');
} else if (process.env.NODE_ENV === 'test') {
	module.exports = {default: async () => {}, unlock: () => {}, isUnlocked: () => false, increment: () => {}, get: () => null, set: () => {}, lock: () => {}};
} else {
	module.exports = require('./index_development');
}
