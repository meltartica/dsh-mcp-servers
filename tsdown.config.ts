/**
 * Browser client bundle for dsh-mcp-servers, mirroring the DeepSeek Harness
 * client preset for an external package: a closure-factory artifact that
 * calls window.__ModuleLoader__.load({ id, factory }) and resolves externals
 * through the injected require (the loader module table). Only react is
 * external; everything else inlines.
 */
import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsdown'

const id = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).name

const CLIENT_EXTERNALS = ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives']

export default defineConfig({
  entry: { client: 'src/client/index.tsx' },
  // Published artifact location: package.json exports "./client" points at
  // client/client.js, so the bundle lands there directly.
  outDir: 'client',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: false,
  clean: false,
  external: CLIENT_EXTERNALS,
  // Anything not in the loader module table must inline — a require() the
  // table cannot answer is a guaranteed runtime throw.
  noExternal: (source: string) => (CLIENT_EXTERNALS.includes(source) ? undefined : true),
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
