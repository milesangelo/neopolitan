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
          { text: 'neopolitan-ai (Umbrella)', link: '/api/neopolitan-ai/README' },
          { text: '@neopolitan-ai/core', link: '/api/@neopolitan-ai/core/README' },
          {
            text: '@neopolitan-ai/runtime-local',
            link: '/api/@neopolitan-ai/runtime-local/README',
          },
          { text: '@neopolitan-ai/sessions', link: '/api/@neopolitan-ai/sessions/README' },
          { text: '@neopolitan-ai/server', link: '/api/@neopolitan-ai/server/README' },
          { text: '@neopolitan-ai/workspace', link: '/api/@neopolitan-ai/workspace/README' },
          { text: '@neopolitan-ai/auth', link: '/api/@neopolitan-ai/auth/README' },
          {
            text: '@neopolitan-ai/orchestration',
            link: '/api/@neopolitan-ai/orchestration/README',
          },
          { text: '@neopolitan-ai/adapter-acp', link: '/api/@neopolitan-ai/adapter-acp/README' },
          {
            text: '@neopolitan-ai/adapter-claude',
            link: '/api/@neopolitan-ai/adapter-claude/README',
          },
          {
            text: '@neopolitan-ai/adapter-codex',
            link: '/api/@neopolitan-ai/adapter-codex/README',
          },
          { text: '@neopolitan-ai/adapter-pty', link: '/api/@neopolitan-ai/adapter-pty/README' },
          { text: '@neopolitan-ai/testing', link: '/api/@neopolitan-ai/testing/README' },
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
