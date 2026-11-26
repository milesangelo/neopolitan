# Getting Started

## 10-Second CLI Quickstart

Check which coding-agent CLIs are installed on your machine (`claude`, `codex`, `opencode`, `agy`, `gemini`, `amp`):

```bash
npx neopolitan-ai doctor
```

Run a single prompt or expose a headless RPC server:

```bash
npx neopolitan-ai run --provider codex "Explain package boundaries"
npx neopolitan-ai serve --host 127.0.0.1 --port 7420 --token secret
```

## Installing the SDK

Install the umbrella package (includes the CLI, core contracts, runtime, adapters, sessions, workspace, server, and orchestration):

```bash
npm install neopolitan-ai
```

Or install granular scoped packages (`@neopolitan-ai/core`, `@neopolitan-ai/adapter-claude`, `@neopolitan-ai/sessions`, etc.):

```bash
npm install @neopolitan-ai/core @neopolitan-ai/runtime-local @neopolitan-ai/adapter-codex @neopolitan-ai/sessions
```

## Minimal Session Example

```ts
import {
  InMemoryEventStore,
  LocalExecutionRuntime,
  SessionManager,
  createDefaultRegistry,
} from 'neopolitan-ai';

const runtime = new LocalExecutionRuntime({ defaultCwd: process.cwd() });
const manager = new SessionManager(createDefaultRegistry(), new InMemoryEventStore(), { runtime });

await using session = await manager.open('claude-code', {
  cwd: process.cwd(),
  permissionMode: 'supervised',
});

const receipt = await session.sendTurn({ prompt: 'Run vitest and inspect failures' });
console.log('Dispatch receipt:', receipt);

for await (const ev of session.events()) {
  if (ev.type === 'assistant.delta') process.stdout.write(ev.text);
  if (ev.type === 'turn.completed') break;
}
```
