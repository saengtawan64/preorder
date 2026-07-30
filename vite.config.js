import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    // Firestore is a large chunk on its own; the default 500 kB warning is noise here.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Keep the Firebase SDK in its own chunk, separate from src/firebase.js,
        // so app-only changes don't bust its cache.
        manualChunks(id) {
          if (/node_modules[\\/]@?firebase/.test(id)) return 'firebase-sdk';
        },
      },
    },
  },
});
