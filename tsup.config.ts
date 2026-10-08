import { defineConfig } from 'tsup'

const shared = {
  format: ['esm', 'cjs'] as ('esm' | 'cjs')[],
  dts: true,
  treeshake: true,
  target: 'es2020' as const,
  external: ['next', 'next/cache', 'react', 'react/jsx-runtime']
}

export default defineConfig([
  {
    ...shared,
    entry: ['src/index.ts', 'src/next.ts', 'src/astro.ts', 'src/html.ts', 'src/image.ts'],
    clean: true
  },
  // Client components: the directive has to open the built file.
  {
    ...shared,
    entry: { react: 'src/react.tsx' },
    treeshake: false,
    banner: { js: "'use client'" },
    esbuildOptions: (o) => {
      o.jsx = 'automatic'
    }
  }
])
