import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Neopolitan',
  description: 'Provider-agnostic TypeScript SDK & CLI for coding-agent harnesses.',
  base: '/neopolitan/',
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Providers', link: '/guide/provider-matrix' },
      { text: 'API Reference', link: '/api/README' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'Architecture & DAG', link: '/guide/architecture' },
          { text: 'Provider Compatibility Matrix', link: '/guide/provider-matrix' },
          { text: 'Custom Adapters & Conformance', link: '/guide/custom-adapter' },
          { text: 'Session Persistence & Handoff', link: '/guide/handoff-and-sessions' },
          { text: 'Security & Approval Gating', link: '/guide/security-and-gating' },
          { text: 'Headless RPC Server', link: '/guide/headless-server' },
          { text: 'Comparisons', link: '/guide/comparisons' },
        ],
      },
      {
        text: 'API Reference',
        items: [
          { text: 'Package Index', link: '/api/README' },
          { text: 'neopolitan (Umbrella)', link: '/api/neopolitan/README' },
          { text: '@neopolitan/core', link: '/api/@neopolitan/core/README' },
          { text: '@neopolitan/runtime-local', link: '/api/@neopolitan/runtime-local/README' },
          { text: '@neopolitan/sessions', link: '/api/@neopolitan/sessions/README' },
          { text: '@neopolitan/server', link: '/api/@neopolitan/server/README' },
          { text: '@neopolitan/workspace', link: '/api/@neopolitan/workspace/README' },
          { text: '@neopolitan/auth', link: '/api/@neopolitan/auth/README' },
          { text: '@neopolitan/orchestration', link: '/api/@neopolitan/orchestration/README' },
          { text: '@neopolitan/adapter-acp', link: '/api/@neopolitan/adapter-acp/README' },
          { text: '@neopolitan/adapter-claude', link: '/api/@neopolitan/adapter-claude/README' },
          { text: '@neopolitan/adapter-codex', link: '/api/@neopolitan/adapter-codex/README' },
          { text: '@neopolitan/adapter-pty', link: '/api/@neopolitan/adapter-pty/README' },
          { text: '@neopolitan/testing', link: '/api/@neopolitan/testing/README' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/milesangelo/neopolitan' }],
    editLink: {
      pattern: 'https://github.com/milesangelo/neopolitan/edit/main/docs/:path',
    },
    search: {
      provider: 'local',
    },
  },
});
