import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Vite does not need to watch the Rust source tree — Tauri CLI handles that
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    // Target the WebView engine for each platform:
    // - Windows: WebView2 (Chromium-based, Chrome 105+)
    // - macOS/Linux: WebKit (Safari 13+)
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: process.env.TAURI_ENV_DEBUG ? false : 'esbuild',
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
})
