import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
const entry = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: entry('./sidepanel.html'),
        options: entry('./options.html'),
        background: entry('./src/background/main.ts'),
        'element-selector': entry('./src/content/element-selector.ts'),
        'bootstrap': entry('./src/content/bootstrap.ts'),
        'injected-ui': entry('./src/content/injected-ui.tsx'),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === 'background') return 'background.js';
          if (chunk.name === 'element-selector') return 'element-selector.js';
           if (chunk.name === 'bootstrap') return 'bootstrap.js';
           if (chunk.name === 'injected-ui') return 'injected-ui.js';
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
});
