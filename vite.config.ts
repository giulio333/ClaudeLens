import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import Icons from 'unplugin-icons/vite'

export default defineConfig({
  plugins: [react(), Icons({ compiler: 'jsx', jsx: 'react' })],
  base: './',
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1000,
  },
})
