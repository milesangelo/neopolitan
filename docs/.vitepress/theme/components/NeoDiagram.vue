<script setup lang="ts">
defineProps<{
  name: 'dag' | 'spi' | 'events' | 'handoff' | 'gates' | 'rpc' | 'worktrees';
}>();
</script>

<template>
  <div class="neo-diagram">
    <svg
      v-if="name === 'dag'"
      viewBox="0 0 820 340"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Neopolitan modular package dependency DAG"
    >
      <defs>
        <marker id="neo-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--vp-c-text-3)" />
        </marker>
      </defs>
      <rect x="275" y="16" width="270" height="46" rx="10" fill="var(--vp-c-bg)" stroke="#E14B6A" stroke-width="2" />
      <text x="410" y="36" text-anchor="middle" font-size="13" font-weight="700" fill="var(--vp-c-text-1)">neopolitan-ai</text>
      <text x="410" y="52" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">Umbrella Re-Exports + Zero-Dep CLI</text>

      <line x1="330" y1="62" x2="155" y2="104" stroke="var(--vp-c-text-3)" stroke-width="1.5" marker-end="url(#neo-arrow)" />
      <line x1="410" y1="62" x2="410" y2="104" stroke="var(--vp-c-text-3)" stroke-width="1.5" marker-end="url(#neo-arrow)" />
      <line x1="490" y1="62" x2="665" y2="104" stroke="var(--vp-c-text-3)" stroke-width="1.5" marker-end="url(#neo-arrow)" />

      <rect x="24" y="108" width="260" height="72" rx="10" fill="var(--vp-c-bg)" stroke="#C98863" stroke-width="1.75" />
      <text x="154" y="131" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--vp-c-text-1)">Provider Adapters</text>
      <text x="154" y="149" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">adapter-claude · adapter-codex</text>
      <text x="154" y="165" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">adapter-acp · adapter-pty (opt. node-pty)</text>

      <rect x="304" y="108" width="212" height="72" rx="10" fill="var(--vp-c-bg)" stroke="#C98863" stroke-width="1.75" />
      <text x="410" y="131" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--vp-c-text-1)">Stateful Infra</text>
      <text x="410" y="149" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">sessions · server</text>
      <text x="410" y="165" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">orchestration</text>

      <rect x="536" y="108" width="260" height="72" rx="10" fill="var(--vp-c-bg)" stroke="#C98863" stroke-width="1.75" />
      <text x="666" y="131" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--vp-c-text-1)">Runtimes &amp; Environment</text>
      <text x="666" y="149" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">runtime-local (Local + WSL2)</text>
      <text x="666" y="165" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">auth (AES-GCM) · workspace (Worktrees)</text>

      <line x1="154" y1="180" x2="310" y2="232" stroke="var(--vp-c-text-3)" stroke-width="1.5" marker-end="url(#neo-arrow)" />
      <line x1="410" y1="180" x2="410" y2="232" stroke="var(--vp-c-text-3)" stroke-width="1.5" marker-end="url(#neo-arrow)" />
      <line x1="666" y1="180" x2="510" y2="232" stroke="var(--vp-c-text-3)" stroke-width="1.5" marker-end="url(#neo-arrow)" />

      <rect x="190" y="236" width="440" height="58" rx="10" fill="var(--vp-c-bg)" stroke="#7A462B" stroke-width="2" />
      <text x="410" y="259" text-anchor="middle" font-size="13" font-weight="700" fill="var(--vp-c-text-1)">@neopolitan-ai/core (Pure TS + Zod)</text>
      <text x="410" y="277" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">ProviderDriver · AgentSession · AgentEvent · GateMiddleware · EventHub · redactSecrets</text>

      <rect x="24" y="242" width="144" height="46" rx="8" fill="var(--vp-c-bg)" stroke="var(--vp-c-divider)" stroke-dasharray="5 3" stroke-width="1.5" />
      <text x="96" y="262" text-anchor="middle" font-size="11.5" font-weight="600" fill="var(--vp-c-text-1)">@neopolitan-ai/testing</text>
      <text x="96" y="278" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">Mocks + /conformance</text>
      <line x1="168" y1="265" x2="186" y2="265" stroke="var(--vp-c-text-3)" stroke-width="1.5" marker-end="url(#neo-arrow)" />

      <text x="410" y="322" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">Verified acyclic by scripts/check-boundaries.mjs and tested across Linux, macOS, and Windows.</text>
    </svg>

    <svg
      v-else-if="name === 'spi'"
      viewBox="0 0 820 180"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Neopolitan 3-tier SPI lifecycle"
    >
      <defs>
        <marker id="spi-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--vp-c-text-3)" />
        </marker>
      </defs>
      <rect x="20" y="34" width="230" height="104" rx="10" fill="var(--vp-c-bg)" stroke="#E14B6A" stroke-width="2" />
      <text x="135" y="58" text-anchor="middle" font-size="13" font-weight="700" fill="var(--vp-c-text-1)">1. ProviderDriver</text>
      <text x="135" y="78" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">Stateless descriptor</text>
      <text x="135" y="96" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">configSchema · baseCapabilities</text>
      <text x="135" y="114" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">probe() · discoverOptions()</text>

      <line x1="250" y1="86" x2="292" y2="86" stroke="var(--vp-c-text-3)" stroke-width="1.75" marker-end="url(#spi-arrow)" />

      <rect x="296" y="34" width="230" height="104" rx="10" fill="var(--vp-c-bg)" stroke="#C98863" stroke-width="2" />
      <text x="411" y="58" text-anchor="middle" font-size="13" font-weight="700" fill="var(--vp-c-text-1)">2. ProviderAdapter</text>
      <text x="411" y="78" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">Bound to runtime + gates</text>
      <text x="411" y="96" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">prepareWorkspace()</text>
      <text x="411" y="114" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">openSession(input, signal)</text>

      <line x1="526" y1="86" x2="568" y2="86" stroke="var(--vp-c-text-3)" stroke-width="1.75" marker-end="url(#spi-arrow)" />

      <rect x="572" y="34" width="228" height="104" rx="10" fill="var(--vp-c-bg)" stroke="#7A462B" stroke-width="2" />
      <text x="686" y="58" text-anchor="middle" font-size="13" font-weight="700" fill="var(--vp-c-text-1)">3. AgentSession</text>
      <text x="686" y="78" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">AsyncDisposable live handle</text>
      <text x="686" y="96" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">sendTurn() · events() · respondToGate()</text>
      <text x="686" y="114" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">getAnchor() · close()</text>
    </svg>

    <svg
      v-else-if="name === 'events'"
      viewBox="0 0 820 175"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="EventHub sequence and afterSeq replay"
    >
      <defs>
        <marker id="ev-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--vp-c-text-3)" />
        </marker>
      </defs>
      <rect x="20" y="28" width="215" height="96" rx="10" fill="var(--vp-c-bg)" stroke="#E14B6A" stroke-width="2" />
      <text x="127" y="54" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--vp-c-text-1)">hub.emit(event)</text>
      <text x="127" y="74" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">Assigns monotonic seq (1, 2, 3...)</text>
      <text x="127" y="92" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">Buffers unless ephemeral: true</text>
      <text x="127" y="110" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">Pushes live to active iterators</text>

      <line x1="235" y1="76" x2="285" y2="76" stroke="var(--vp-c-text-3)" stroke-width="1.75" marker-end="url(#ev-arrow)" />

      <rect x="289" y="28" width="235" height="96" rx="10" fill="var(--vp-c-bg)" stroke="#C98863" stroke-width="2" />
      <text x="406" y="54" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--vp-c-text-1)">Replay Ring Buffer (2,048)</text>
      <text x="406" y="74" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">Startup session.started never lost</text>
      <text x="406" y="92" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">Late subscribe(&#123; afterSeq &#125;)</text>
      <text x="406" y="110" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">replays seq &gt; afterSeq in order</text>

      <line x1="524" y1="76" x2="574" y2="76" stroke="var(--vp-c-text-3)" stroke-width="1.75" marker-end="url(#ev-arrow)" />

      <rect x="578" y="28" width="222" height="96" rx="10" fill="var(--vp-c-bg)" stroke="#7A462B" stroke-width="2" />
      <text x="689" y="54" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--vp-c-text-1)">TurnItemAccumulator</text>
      <text x="689" y="74" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">Deterministic UI block state:</text>
      <text x="689" y="92" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">text · reasoning · tool_call</text>
      <text x="689" y="110" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">file_diff · plan · gate</text>

      <text x="410" y="154" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">Strict ordering and afterSeq deduplication are verified by @neopolitan-ai/testing/conformance.</text>
    </svg>

    <svg
      v-else-if="name === 'handoff'"
      viewBox="0 0 820 205"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Hybrid handoff decision tree"
    >
      <defs>
        <marker id="hoff-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--vp-c-text-3)" />
        </marker>
      </defs>
      <rect x="20" y="64" width="210" height="72" rx="10" fill="var(--vp-c-bg)" stroke="#E14B6A" stroke-width="2" />
      <text x="125" y="90" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--vp-c-text-1)">SessionManager.handoff()</text>
      <text x="125" y="109" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">Reads snapshot + .events.jsonl</text>
      <text x="125" y="125" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">Same provider + cwd + profile?</text>

      <line x1="230" y1="84" x2="310" y2="52" stroke="var(--vp-c-text-3)" stroke-width="1.75" marker-end="url(#hoff-arrow)" />
      <text x="270" y="56" text-anchor="middle" font-size="10.5" font-weight="600" fill="var(--vp-c-brand-1)">YES</text>

      <line x1="230" y1="116" x2="310" y2="148" stroke="var(--vp-c-text-3)" stroke-width="1.75" marker-end="url(#hoff-arrow)" />
      <text x="270" y="148" text-anchor="middle" font-size="10.5" font-weight="600" fill="var(--vp-c-text-2)">NO</text>

      <rect x="314" y="20" width="484" height="62" rx="10" fill="var(--vp-c-bg)" stroke="#7A462B" stroke-width="1.75" />
      <text x="556" y="45" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--vp-c-text-1)">strategy: 'native-resume'</text>
      <text x="556" y="64" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">Reuses source nativeAnchor (sessionId / threadId) directly — zero re-summarization</text>

      <rect x="314" y="104" width="484" height="84" rx="10" fill="var(--vp-c-bg)" stroke="#C98863" stroke-width="1.75" />
      <text x="556" y="128" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--vp-c-text-1)">strategy: 'compiled-prelude'</text>
      <text x="556" y="147" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">1. Optional HandoffSummarizer (50% tokenBudget) + recent turns (60% chars) + gitDiff (25%)</text>
      <text x="556" y="165" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">2. Scrubs all sections with redactSecrets() before injecting target contextPrelude</text>
    </svg>

    <svg
      v-else-if="name === 'gates'"
      viewBox="0 0 820 190"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="GateMiddleware evaluation pipeline"
    >
      <defs>
        <marker id="gate-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--vp-c-text-3)" />
        </marker>
      </defs>
      <rect x="20" y="42" width="185" height="90" rx="10" fill="var(--vp-c-bg)" stroke="#E14B6A" stroke-width="2" />
      <text x="112" y="68" text-anchor="middle" font-size="12" font-weight="700" fill="var(--vp-c-text-1)">1. Safety Override</text>
      <text x="112" y="88" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">kind === 'elicitation' OR</text>
      <text x="112" y="104" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">isDisguisedElicitation</text>
      <text x="112" y="120" text-anchor="middle" font-size="10.5" font-weight="600" fill="var(--vp-c-brand-1)">Always Interactive</text>

      <line x1="205" y1="87" x2="233" y2="87" stroke="var(--vp-c-text-3)" stroke-width="1.5" marker-end="url(#gate-arrow)" />

      <rect x="237" y="42" width="175" height="90" rx="10" fill="var(--vp-c-bg)" stroke="#C98863" stroke-width="1.75" />
      <text x="324" y="68" text-anchor="middle" font-size="12" font-weight="700" fill="var(--vp-c-text-1)">2. PolicyRule Match</text>
      <text x="324" y="88" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">category · toolPattern</text>
      <text x="324" y="104" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">commandPattern · pathGlob</text>
      <text x="324" y="120" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">allow (unless ruleForced) / deny / ask</text>

      <line x1="412" y1="87" x2="440" y2="87" stroke="var(--vp-c-text-3)" stroke-width="1.5" marker-end="url(#gate-arrow)" />

      <rect x="444" y="42" width="180" height="90" rx="10" fill="var(--vp-c-bg)" stroke="#C98863" stroke-width="1.75" />
      <text x="534" y="68" text-anchor="middle" font-size="12" font-weight="700" fill="var(--vp-c-text-1)">3. PermissionMode</text>
      <text x="534" y="88" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">full_access (unless ruleForced)</text>
      <text x="534" y="104" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">auto_accept_edits (files/patch)</text>
      <text x="534" y="120" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">auto -&gt; async autoJudge()</text>

      <line x1="624" y1="87" x2="652" y2="87" stroke="var(--vp-c-text-3)" stroke-width="1.5" marker-end="url(#gate-arrow)" />

      <rect x="656" y="42" width="144" height="90" rx="10" fill="var(--vp-c-bg)" stroke="#7A462B" stroke-width="2" />
      <text x="728" y="68" text-anchor="middle" font-size="12" font-weight="700" fill="var(--vp-c-text-1)">4. Interactive</text>
      <text x="728" y="88" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">User handler or</text>
      <text x="728" y="104" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">respondToGate()</text>
      <text x="728" y="120" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">RPC call</text>

      <text x="410" y="166" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">URL elicitations set personOnly: true so remote subagents cannot consent to OAuth flows on a user's behalf.</text>
    </svg>

    <svg
      v-else-if="name === 'rpc'"
      viewBox="0 0 820 215"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Non-blocking HTTP+SSE RPC sequence"
    >
      <defs>
        <marker id="rpc-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--vp-c-text-3)" />
        </marker>
      </defs>
      <rect x="44" y="14" width="160" height="36" rx="8" fill="var(--vp-c-bg)" stroke="#E14B6A" stroke-width="1.75" />
      <text x="124" y="37" text-anchor="middle" font-size="12" font-weight="700" fill="var(--vp-c-text-1)">AgentRpcClient</text>
      <line x1="124" y1="50" x2="124" y2="195" stroke="var(--vp-c-divider)" stroke-dasharray="4 4" stroke-width="1.5" />

      <rect x="330" y="14" width="160" height="36" rx="8" fill="var(--vp-c-bg)" stroke="#C98863" stroke-width="1.75" />
      <text x="410" y="37" text-anchor="middle" font-size="12" font-weight="700" fill="var(--vp-c-text-1)">AgentRpcServer</text>
      <line x1="410" y1="50" x2="410" y2="195" stroke="var(--vp-c-divider)" stroke-dasharray="4 4" stroke-width="1.5" />

      <rect x="616" y="14" width="160" height="36" rx="8" fill="var(--vp-c-bg)" stroke="#7A462B" stroke-width="1.75" />
      <text x="696" y="37" text-anchor="middle" font-size="12" font-weight="700" fill="var(--vp-c-text-1)">AgentSession</text>
      <line x1="696" y1="50" x2="696" y2="195" stroke="var(--vp-c-divider)" stroke-dasharray="4 4" stroke-width="1.5" />

      <line x1="124" y1="74" x2="404" y2="74" stroke="var(--vp-c-text-2)" stroke-width="1.5" marker-end="url(#rpc-arrow)" />
      <text x="267" y="68" text-anchor="middle" font-size="11" fill="var(--vp-c-text-1)">POST /rpc session.sendTurn (Authorization: Bearer ...)</text>

      <line x1="404" y1="98" x2="130" y2="98" stroke="#E14B6A" stroke-width="1.5" marker-end="url(#rpc-arrow)" />
      <text x="267" y="92" text-anchor="middle" font-size="11" font-weight="600" fill="var(--vp-c-brand-1)">Immediate DispatchReceipt (non-blocking)</text>

      <line x1="696" y1="124" x2="130" y2="124" stroke="var(--vp-c-text-2)" stroke-width="1.5" marker-end="url(#rpc-arrow)" />
      <text x="410" y="118" text-anchor="middle" font-size="11" fill="var(--vp-c-text-1)">SSE /events/:id (or WS) streams gate.requested (id: seq)</text>

      <line x1="124" y1="150" x2="404" y2="150" stroke="var(--vp-c-text-2)" stroke-width="1.5" marker-end="url(#rpc-arrow)" />
      <text x="267" y="144" text-anchor="middle" font-size="11" fill="var(--vp-c-text-1)">POST /rpc session.respondToGate (unblocked by KeyedLock)</text>

      <line x1="696" y1="176" x2="130" y2="176" stroke="var(--vp-c-text-2)" stroke-width="1.5" marker-end="url(#rpc-arrow)" />
      <text x="410" y="170" text-anchor="middle" font-size="11" fill="var(--vp-c-text-1)">assistant.delta -&gt; assistant.completed -&gt; turn.completed</text>
    </svg>

    <svg
      v-else-if="name === 'worktrees'"
      viewBox="0 0 820 155"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="6-tier worktree safety classification"
    >
      <rect x="20" y="24" width="122" height="72" rx="8" fill="var(--vp-c-bg)" stroke="#E14B6A" stroke-width="2" />
      <text x="81" y="50" text-anchor="middle" font-size="12" font-weight="700" fill="var(--vp-c-text-1)">in-use</text>
      <text x="81" y="70" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">Active session</text>
      <text x="81" y="85" text-anchor="middle" font-size="10.5" fill="#E14B6A">Never delete</text>

      <rect x="154" y="24" width="142" height="72" rx="8" fill="var(--vp-c-bg)" stroke="#E14B6A" stroke-width="2" />
      <text x="225" y="50" text-anchor="middle" font-size="12" font-weight="700" fill="var(--vp-c-text-1)">review</text>
      <text x="225" y="70" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">Dirty / detached / unmerged</text>
      <text x="225" y="85" text-anchor="middle" font-size="10.5" fill="#E14B6A">Never auto-delete</text>

      <rect x="308" y="24" width="118" height="72" rx="8" fill="var(--vp-c-bg)" stroke="#C98863" stroke-width="1.75" />
      <text x="367" y="50" text-anchor="middle" font-size="12" font-weight="700" fill="var(--vp-c-text-1)">orphaned</text>
      <text x="367" y="70" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">Clean &amp; detached</text>
      <text x="367" y="85" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">from task</text>

      <rect x="438" y="24" width="114" height="72" rx="8" fill="var(--vp-c-bg)" stroke="#7A462B" stroke-width="1.75" />
      <text x="495" y="50" text-anchor="middle" font-size="12" font-weight="700" fill="var(--vp-c-text-1)">merged</text>
      <text x="495" y="70" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">Clean &amp; merged</text>
      <text x="495" y="85" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">Safe to prune</text>

      <rect x="564" y="24" width="120" height="72" rx="8" fill="var(--vp-c-bg)" stroke="#7A462B" stroke-width="1.75" />
      <text x="624" y="50" text-anchor="middle" font-size="12" font-weight="700" fill="var(--vp-c-text-1)">at-base-commit</text>
      <text x="624" y="70" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">No new commits</text>
      <text x="624" y="85" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">Safe to prune</text>

      <rect x="696" y="24" width="106" height="72" rx="8" fill="var(--vp-c-bg)" stroke="var(--vp-c-divider)" stroke-width="1.5" />
      <text x="749" y="50" text-anchor="middle" font-size="12" font-weight="700" fill="var(--vp-c-text-1)">unreferenced</text>
      <text x="749" y="70" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">Fallback</text>
      <text x="749" y="85" text-anchor="middle" font-size="10.5" fill="var(--vp-c-text-2)">Prune w/ policy</text>

      <text x="410" y="130" text-anchor="middle" font-size="11" fill="var(--vp-c-text-2)">GitWorkspaceManager serializes per-repo git worktree mutations with internal locking so parallel agents never race.</text>
    </svg>
  </div>
</template>
