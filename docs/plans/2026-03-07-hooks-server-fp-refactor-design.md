# hooks.server.ts FP Refactor Design

**Goal:** Reduce complexity and apply FP best practices to `src/hooks.server.ts` by splitting concerns into focused modules and composing them with SvelteKit's `sequence` pipeline.

## Architecture

`hooks.server.ts` becomes a thin composition root. Three focused `Handle` modules are extracted, each independently testable and responsible for a single concern.

```
src/hooks.server.ts              ← sequence(handleWsInit, handleTarpit, handleAdminAuth)
src/lib/server/ws-init.ts        ← WebSocket init guard
src/lib/server/tarpit.ts         ← tarpit logic: bomb + LLM streaming
src/lib/server/admin-auth.ts     ← admin basic-auth gate
```

## Key FP Principles Applied

- **Pure data builders** — `makeConnectionStartedEvent`, `makeBombServedEvent`, `makeConnectionDroppedEvent`, `createBombResponse` construct plain objects/Responses with no side effects
- **Single side-effectful sink** — `logTarpitEvent` is the only function that writes to disk; all callers pass pre-built plain objects to it
- **Pure decision functions** — `selectTarpitMode`, `getClientIp`, `buildExpectedAuth`, `getAuthHeader` are all pure
- **Encapsulated mutable state** — `bombReady`/`bombBuffer` remain module-private inside `tarpit.ts`; `wsServerInitialized` is module-private inside `ws-init.ts`
- **Unified teardown** — `createTarpitStream` unifies the success/error teardown paths (previously duplicated `logTarpitEvent` calls)
- **Extracted prompt constant** — `TARPIT_PROMPT` is a named constant rather than an inline string literal
- **`sequence` pipeline** — handlers compose via SvelteKit's built-in `sequence` rather than nested if/else

## Data Flow

```
Request
  → handleWsInit    (side effect: init WS once; passes through)
  → handleTarpit    (TRAP_PATHS match? → bomb or LLM stream; else passes through)
  → handleAdminAuth (/admin? → check Basic auth; else passes through)
  → resolve(event)