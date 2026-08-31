import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/*
  Where the app will be served from.

  A GitHub Pages project page serves at /<repo>/; a custom domain serves at the
  root. The deploy workflow decides which by looking for public/CNAME and passes
  the answer in, so adding a domain later is one file and no config change.

  Routing is hash-based, which is what makes either path work without the host
  rewriting unknown URLs to index.html — GitHub Pages does not, and neither does
  a Capacitor WebView.
*/
const base = process.env.AGENTIX_BASE ?? '/'

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
})
