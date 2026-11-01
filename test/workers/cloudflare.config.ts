// cf build / cf dev read this (the Cloudflare Vite plugin builds and serves it in workerd)
import { defineConfig } from '@cloudflare/config';
export default defineConfig({ worker: { name: 'mpljs-runtime-test', compatibilityDate: '2026-10-01', entrypoint: './src/worker.ts' } });
