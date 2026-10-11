import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: false,
  clean: true,
  splitting: false,
  sourcemap: true,
  target: 'node18',
  // The .mcpb bundle installs only production deps from npm, where the
  // workspace SDK does not exist — so inline it.
  noExternal: ['@chainpemonad/sdk'],
  banner: {
    js: '#!/usr/bin/env node'
  }
})
