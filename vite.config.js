import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { buildRuntime, defaultCacheDir } from './scripts/emulatorjs-runtime.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.data': 'application/octet-stream' };

/**
 * Serves the pinned EmulatorJS runtime and cores from RetroPlay's own origin (dev server and
 * production build) instead of cdn.emulatorjs.org, and stamps the service worker with a build ID
 * so installed copies notice new versions.
 */
function emulatorJsSelfHost() {
  const cacheDir = defaultCacheDir(root);
  const staging = path.join(cacheDir, 'site');
  let manifest = null;
  let outDir = path.join(root, 'dist');
  return {
    name: 'retroplay-emulatorjs-self-host',
    async config() {
      manifest = await buildRuntime({ cacheDir, outDir: staging });
      return {
        define: {
          __EJS_RUNTIME__: JSON.stringify({ dataPath: manifest.dataPath, script: manifest.script, style: manifest.style, buildId: manifest.buildId })
        }
      };
    },
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        if (!url.pathname.startsWith('/emulatorjs/')) return next();
        const file = path.join(staging, decodeURIComponent(url.pathname));
        if (!file.startsWith(staging) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
        res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
        fs.createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      if (!manifest || !fs.existsSync(outDir)) return;
      fs.cpSync(path.join(staging, 'emulatorjs'), path.join(outDir, 'emulatorjs'), { recursive: true });
      const workerFile = path.join(outDir, 'service-worker.js');
      if (fs.existsSync(workerFile)) {
        const html = fs.readFileSync(path.join(outDir, 'index.html'));
        const buildId = `${pkg.version}-${manifest.buildId}-${createHash('sha256').update(html).digest('hex').slice(0, 10)}`;
        const assets = fs.readdirSync(path.join(outDir, 'assets')).filter(name => /\.(js|css|svg|png|webp|woff2?)$/.test(name)).sort().map(name => `/assets/${name}`);
        const source = fs.readFileSync(workerFile, 'utf8');
        if (!source.includes('__RETROPLAY_BUILD_ID__') || !source.includes('/*__RETROPLAY_APP_ASSETS__*/')) throw new Error('service-worker.js is missing a build placeholder.');
        fs.writeFileSync(workerFile, source.replace('__RETROPLAY_BUILD_ID__', buildId).replace('/*__RETROPLAY_APP_ASSETS__*/', assets.map(asset => JSON.stringify(asset)).join(', ')));
      }
    }
  };
}

export default defineConfig({
  base: '/',
  publicDir: 'public',
  define: {
    // Used for backup metadata so exported files name the real app version.
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  plugins: [svelte(), emulatorJsSelfHost()],
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
