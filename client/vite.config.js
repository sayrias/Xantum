import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  // simple-peer ve diğer Node.js kütüphaneleri için global polyfill
  define: {
    global: 'globalThis',
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port: 5173,
  },
})
