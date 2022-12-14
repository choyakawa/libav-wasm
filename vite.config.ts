import { defineConfig } from 'vite'
import commonjs from '@rollup/plugin-commonjs'

export default defineConfig({
  build: {
    target: 'esnext',
    outDir: 'build',
    lib: {
      name: '@banou26/oz-libav',
      fileName: 'index',
      entry: 'src/index.ts',
      formats: ['es']
    },
    rollupOptions: {
      input: {
        index: 'src/index.ts',
        worker: 'src/worker/index.ts'
      },
      external: ['buffer', 'mp4box', 'osra']
    }
  },
  plugins: [
    commonjs()
  ],
  optimizeDeps: {
    include: ['libav']
  }
})