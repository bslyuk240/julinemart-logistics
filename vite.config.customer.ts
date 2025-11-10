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
  },
  preview: {
    port: 5002,
    open: '/customer-portal.html',
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
