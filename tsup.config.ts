import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/next.ts', 'src/astro.ts', 'src/html.ts', 'src/image.ts', 'src/cli.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  treeshake: true,
  target: 'es2020',
  external: ['next', 'next/cache']
})
