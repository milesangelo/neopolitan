import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Neopolitan',
  description: 'Provider-agnostic TypeScript SDK & CLI for coding-agent harnesses.',
  base: '/neopolitan/',
  cleanUrls: true,
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/neopolitan/favicon.svg' }]],
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Start', link: '/guide/getting-started' },
      { text: 'Concepts', link: '/concepts/architecture' },
      { text: 'Patterns', link: '/patterns/provider-swap-handoff' },
      { text: 'Providers', link: '/guide/provider-matrix' },
      { text: 'API Reference', link: '/api/README' },
    ],
    sidebar: [
      {
        text: 'Start',
        items: [
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'CLI Reference', link: '/guide/cli' },
          { text: 'Provider Compatibility Matrix', link: '/guide/provider-matrix' },
          { text: 'Comparisons', link: '/guide/comparisons' },
        ],
      },
      {
        text: 'Core Concepts',
        items: [
          { text: 'Architecture & 3-Tier SPI', link: '/concepts/architecture' },
          { text: 'Canonical Events & Receipts', link: '/concepts/events-and-receipts' },
          { text: 'Capabilities & Runtimes', link: '/concepts/capabilities-and-runtimes' },
          { text: 'Auth & Env Isolation', link: '/concepts/auth-and-env' },
        ],
      },
      {
        text: 'Patterns & Recipes',
        items: [
          { text: 'Provider Swap & Hybrid Handoff', link: '/patterns/provider-swap-handoff' },
          { text: 'Policy Gates & Elicitation', link: '/patterns/policy-gates-and-elicitation' },
          { text: 'Headless RPC Server (HTTP+SSE & WS)', link: '/patterns/headless-rpc-server' },
          { text: 'Isolated Worktrees & Code Review', link: '/patterns/worktrees-and-review' },
          { text: 'Multi-Agent & Quota Fallback', link: '/patterns/multi-agent-orchestration' },
          { text: 'Custom Adapters & Conformance', link: '/patterns/custom-adapters' },
        ],
      },
      {
        text: 'API Reference',
        collapsed: true,
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
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Neopolitan Contributors',
    },
    search: {
      provider: 'local',
    },
  },
});
