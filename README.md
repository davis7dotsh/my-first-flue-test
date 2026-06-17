# Flue + SvelteKit demo

A deliberately small stateful agent stack on Cloudflare:

- SvelteKit renders the chat UI as a Cloudflare Worker.
- A second Worker runs a Flue agent backed by Durable Objects.
- A Cloudflare service binding connects the SvelteKit Worker to the agent Worker.
- D1 stores the browser-owned thread index used by the sidebar.
- Workers AI provides the model, so there is no external model API key.
- The agent has one typed `run_test` tool and no Git checkout, container, or external sandbox.
- The UI displays Flue's Durable Streams events while the response runs.

## Layout

```text
.
├── src/
│   ├── lib/components/ChatThread.svelte   # Durable replay and live chat UI
│   ├── routes/chat/[id]/+page.svelte      # Thread URL
│   ├── routes/api/threads/+server.ts      # D1 thread index API
│   └── routes/api/flue/[...path]/+server.ts
│                                           # Authorized same-origin Flue proxy
├── agent/
│   ├── src/agents/demo-agent.ts            # Agent and run_test tool
│   ├── flue.config.ts
│   └── wrangler.jsonc                      # Flue Worker and DO migrations
├── migrations/0001_create_threads.sql      # D1 thread metadata
├── turbo.json                              # Interactive two-process dev runner
└── wrangler.jsonc                          # Web Worker, service, and D1 bindings
```

## Run locally

Install dependencies once:

```sh
pnpm install
```

Create the local proxy configuration:

```sh
cp .env.example .env
```

Apply the D1 schema to local development storage:

```sh
pnpm db:migrate:local
```

Start both the Flue Worker and SvelteKit in Turborepo's interactive TUI:

```sh
pnpm dev
```

Use the arrow keys or `j`/`k` to switch tasks, `i` to interact with the selected process, `Ctrl+z` to stop interacting, and `m` to show all TUI keybindings.

Open the SvelteKit URL and create a thread. Flue runs locally on port `3583`; the SvelteKit endpoint proxies authorized `/api/flue/*` requests to it.

## How the durable thread works

The web Worker creates each thread in D1 with an owner cookie, title, timestamps, and the `demo-agent` agent name. The thread ID is also the Flue instance ID, so each D1 row points to one Durable Object-backed conversation.

Flue remains the source of truth for conversation content. Opening `/chat/:id` replays the agent event stream from offset `-1` and keeps the stream live. A refresh during generation therefore rebuilds completed history and continues receiving the in-flight response. New threads begin reading from the admission offset returned by `client.agents.send(...)`.

## Check the project

```sh
pnpm typegen
pnpm agent:check
pnpm check
pnpm lint
```

## Deploy

Authenticate Wrangler, then deploy the agent Worker first:

```sh
pnpm exec wrangler login
pnpm agent:deploy
```

Apply the production D1 migration:

```sh
pnpm db:migrate:remote
```

Deploy the SvelteKit Worker after the `flue-sveltekit-agent` service exists:

```sh
pnpm deploy
```

The production SvelteKit Worker uses its `FLUE_AGENT` service binding. `FLUE_AGENT_URL` is only the local HTTP fallback.

## Production note

The demo scopes threads with an HTTP-only browser cookie and verifies ownership before forwarding to Flue. Replace that anonymous owner with real authentication before exposing user data in production.
