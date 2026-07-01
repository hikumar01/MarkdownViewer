import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom',
    // happy-dom eagerly navigates/fetches its browser frame on init and when a
    // frame is torn down (aggravated by the per-file env switch to jsdom in
    // purify.test.ts) it logs a benign but noisy "AsyncTaskManager has been
    // destroyed" rejection. Unit tests never rely on real navigation or remote
    // resource loading, so disable both to keep the run clean and hermetic.
    environmentOptions: {
      happyDOM: {
        settings: {
          disableJavaScriptFileLoading: true,
          disableCSSFileLoading: true,
          navigation: {
            disableMainFrameNavigation: true,
            disableChildFrameNavigation: true,
          },
        },
      },
    },
    include: ['ui/**/*.test.ts'],
    globals: false,
    setupFiles: ['ui/__tests__/setup.ts'],
    server: {
      deps: {
        // Vite plugins reference `?inline` CSS imports (theme.ts). Inline them
        // so the test runner does not try to resolve them as real modules.
        inline: ['github-markdown-css'],
      },
    },
  },
  resolve: {
    alias: [
      // Stub Tauri APIs — tests must not depend on the Tauri runtime.
      { find: /^@tauri-apps\/api\/core$/,    replacement: new URL('./ui/__tests__/stubs/tauri-core.ts', import.meta.url).pathname },
      { find: /^@tauri-apps\/api\/event$/,   replacement: new URL('./ui/__tests__/stubs/tauri-event.ts', import.meta.url).pathname },
      { find: /^@tauri-apps\/plugin-dialog$/, replacement: new URL('./ui/__tests__/stubs/tauri-dialog.ts', import.meta.url).pathname },
    ],
  },
})
