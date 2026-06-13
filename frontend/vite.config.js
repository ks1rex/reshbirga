import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
#asda
export default defineConfig({
  plugins: [react()],
  base: '/reshbirga/',
  server: { port: 5173 },
  build: { sourcemap: false },
});

