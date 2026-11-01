import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';
// `cf dev` cannot forward --port to vite, so the test picks the port through the environment
const port = Number(process.env['MPLJS_WORKERS_PORT'] || '5173');
export default defineConfig({ plugins: [cloudflare()], server: { port, strictPort: true, fs: { allow: ['../..'] } } });
