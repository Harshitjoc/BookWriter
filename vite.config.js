import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/* The React cockpit only. Vite is driven in middleware mode by src/server/index.mjs,
   which merges this config with the runtime root/port. Kept here so the app reads
   like a standard Vite project. */
export default defineConfig({
  plugins: [react()],
});
