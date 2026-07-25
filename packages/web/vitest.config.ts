import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		// jsdom, because the units under test touch localStorage, Date locale
		// formatting and window — not because any component is rendered here.
		environment: 'jsdom',
		include: ['src/**/*.test.ts'],
	},
});
