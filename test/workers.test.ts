// dist/browser inside workerd, built and served with the Cloudflare CLI `cf` (no wrangler anywhere):
// test/workers is a tiny Worker that imports the published build and renders every runtime case.
//   1. `cf build`  — bundles the Worker (Build Output Spec, .cloudflare/output)
//   2. `cf dev`    — serves it in workerd; GET /render
//   3. the cf build output itself is served in workerd (vite preview, cf's delegate) and rendered again
// Both outputs must equal mpljs-on-Node byte for byte and match Agg pixel for pixel. `npm run test:workers`.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { check, fixtures, type RuntimeOutput } from './runtime/common.ts';

const ROOT = new URL('../', import.meta.url).pathname;
const W = join(ROOT, 'test/workers');
const run = (cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env): string =>
  execFileSync(cmd, args, { cwd: W, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

execFileSync(process.execPath, [join(ROOT, 'scripts/build_package.ts')], { stdio: 'pipe' });
if (!existsSync(join(W, 'node_modules/.bin/cf'))) run('npm', ['ci', '--no-audit', '--no-fund']);
writeFileSync(join(W, 'src/cases.gen.json'), JSON.stringify(fixtures()));
// the Worker imports dist/browser, so it is typechecked here rather than by the root tsconfig
execFileSync(join(ROOT, 'node_modules/.bin/tsc'), ['-p', join(W, 'tsconfig.json')], { stdio: 'inherit' });

const freePort = (): Promise<number> => new Promise((r) => {
  const s = createServer().listen(0, '127.0.0.1', () => { const a = s.address(); s.close(() => r(typeof a === 'object' && a !== null ? a.port : 0)); });
});

/* oxlint-disable no-await-in-loop -- polling a starting server is sequential by nature */
async function serveAndRender(label: string, args: string[]): Promise<{ runtime: string; outs: RuntimeOutput[] }> {
  const port = await freePort();
  const child: ChildProcess = spawn('npx', args.map((a) => a.replace('$PORT', String(port))), {
    cwd: W, env: { ...process.env, MPLJS_WORKERS_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  let log = '';
  child.stdout?.on('data', (d) => { log += d; });
  child.stderr?.on('data', (d) => { log += d; });
  try {
    for (let i = 0; i < 120; i++) {
      try {
        const r = await fetch(`http://localhost:${port}/render`);
        if (r.ok) {
          const j = await r.json() as { runtime: string; out: { name: string; svg: string; png64: string; ms: number }[] };
          return { runtime: j.runtime, outs: j.out.map((o) => ({ name: o.name, svg: o.svg, png: Buffer.from(o.png64, 'base64'), ms: o.ms })) };
        }
      } catch { /* not up yet */ }
      if (child.exitCode !== null) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`${label}: no response on :${port}\n${log}`);
  } finally {
    try { process.kill(-(child.pid ?? 0), 'SIGTERM'); } catch { /* gone */ }
  }
}

/* oxlint-enable no-await-in-loop */

const cfVersion = run('npx', ['cf', '--version']).trim();
run('npx', ['cf', 'build']);
const bundle = readFileSync(join(W, '.cloudflare/output/v0/workers/default/bundle/index.js'));
const kb = (n: number): string => `${(n / 1024).toFixed(0)} KiB`;
console.log(`workers: cf ${cfVersion}; cf build ok (Worker bundle ${kb(bundle.length)}, gzip ${kb(gzipSync(bundle).length)}, incl. 9 fixture specs)`);

let fails = 0;
const dev = await serveAndRender('cf dev', ['cf', 'dev']);
console.log(`workers: cf dev → workerd (navigator.userAgent ${JSON.stringify(dev.runtime)})`);
fails += check('workerd/cf-dev', dev.outs);
const built = await serveAndRender('cf build output', ['vite', 'preview', '--port', '$PORT', '--strictPort']);
console.log(`workers: cf build output → workerd (navigator.userAgent ${JSON.stringify(built.runtime)})`);
fails += check('workerd/cf-build', built.outs);

if (fails > 0) { console.log(`workers: ${fails} failure(s)`); process.exit(1); }
console.log('workers: every case pixel-exact, output identical to Node');
process.exit(0);
