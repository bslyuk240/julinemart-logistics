import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3002, // Different port for customer portal
    open: '/customer-portal.html', // Open the customer portal entry, not admin
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 5002,
    open: '/customer-portal.html',
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist/customer-portal',
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'customer-portal.html'),
      },
    },
  },
});
