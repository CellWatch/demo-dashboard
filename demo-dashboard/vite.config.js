import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: [react()],

  base: process.env.VITE_BASE || (mode === 'production' ? '/demo-dashboard/' : '/'),

  build: {
    outDir: 'dist',
    emptyOutDir: true
  },

  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true
      }
    }
  }
}))