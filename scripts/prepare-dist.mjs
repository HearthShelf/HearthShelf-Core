// Build dist/ from src/ so the compiled JS never drifts from the TypeScript
// source. Runs as the npm `prepare` lifecycle script, i.e. on every
// `npm install`/`npm ci` that includes devDependencies (where TypeScript lives).
//
// Why a script instead of just `"prepare": "tsc ..."`:
//   - Production/`--omit=dev` installs have no TypeScript. npm skips `prepare`
//     on `--omit=dev` at the top level, but `prepare` can still fire for this
//     package in other contexts (e.g. as a git/file dependency). If tsc is
//     absent we must NO-OP, not crash the whole install.
//   - Bundler consumers (mobile Metro, web Vite) read src/*.ts directly via a
//     path alias and never need dist. It's only the no-bundler server that
//     imports dist/*.js - so a missing dist there is fatal, but a missing tsc
//     here just means "this install doesn't need dist built".
//
// Net effect: anyone who installs core WITH its dev deps gets a fresh dist
// automatically; anyone who can't build (no tsc) is left untouched. The Docker
// image also builds dist explicitly, so the server image is covered either way.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

// Resolve the local TypeScript compiler. If core's devDeps aren't installed
// (production/omit-dev), there's nothing to build with - skip quietly.
const tscBin = join(
  root,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsc.cmd' : 'tsc',
)
if (!existsSync(tscBin)) {
  console.log('[core:prepare] TypeScript not installed (production install?) - skipping dist build.')
  process.exit(0)
}

const res = spawnSync(tscBin, ['-p', 'tsconfig.build.json'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

if (res.status !== 0) {
  console.error('[core:prepare] dist build failed.')
  process.exit(res.status ?? 1)
}
console.log('[core:prepare] dist built from src.')
