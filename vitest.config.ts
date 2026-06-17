import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
	resolve: {
		alias: {
			$lib: fileURLToPath(new URL('./src/lib', import.meta.url))
		}
	},
	plugins: [
		cloudflareTest(async () => ({
			main: './test/worker.ts',
			miniflare: {
				compatibilityDate: '2026-06-16',
				compatibilityFlags: ['nodejs_compat'],
				d1Databases: ['THREADS_DB'],
				bindings: {
					TEST_MIGRATIONS: await readD1Migrations(`${root}migrations`)
				}
			}
		}))
	],
	test: {
		setupFiles: ['./test/setup.ts']
	}
});
