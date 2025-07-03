/* eslint-disable global-require */

if (process.env.NODE_ENV === 'production') {
	export * from './index_production.js';
} else {
	export * from './index_development.js';
}
