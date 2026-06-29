import {defineConfig} from 'vitest/config';

export default defineConfig({
	resolve: {
		extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'],
	},
	test: {
		globals: true,
		setupFiles: ['./vitest.setup.ts'],
		environment: 'node',
		include: ['**/*.{test,spec}.{ts,js}'],
		exclude: ['node_modules', '.build', 'functions/node_modules/**'],
		coverage: {
			provider: 'v8',
			include: ['**/*.{js,ts}'],
			exclude: ['**/*.test.{js,ts}', 'bin', 'coverage', 'node_modules', '.build'],
		},
		testTimeout: 10000,
	},
});
