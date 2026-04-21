import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev-only proxies. In production (Cloudflare Pages), /api/* is handled by
// Pages Functions in /functions/api/**.
//
// Two dev options:
//   1. `npm run dev` — vite only. /api/ollama is proxied to Tokai by Vite.
//      /api/claude does NOT work here (you'd need your key in the browser).
//   2. `npm run dev:proxy` — wrangler pages dev + vite. Pages Functions run
//      locally, reading secrets from .dev.vars. Both /api/claude and
//      /api/ollama match production behaviour.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/ollama': {
        target: 'http://tokai.informatik.umu.se:11434',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/ollama/, ''),
      },
    },
  },
})
