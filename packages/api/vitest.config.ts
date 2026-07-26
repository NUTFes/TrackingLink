import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		// Node, not workerd: only pure logic is covered here (see fallback.test.ts).
		// Anything needing real D1 or a request context is verified through
		// `wrangler dev --local` and the k6 smoke scenario instead.
		environment: 'node',
		include: ['src/**/*.test.ts'],
	},
});
