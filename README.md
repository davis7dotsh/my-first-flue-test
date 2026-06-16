# Flue + SvelteKit demo

A deliberately small stateful agent stack on Cloudflare:

- SvelteKit renders the chat UI as a Cloudflare Worker.
- A second Worker runs a Flue agent backed by Durable Objects.
- A Cloudflare service binding connects the SvelteKit Worker to the agent Worker.
- Workers AI provides the model, so there is no external model API key.
- The agent has one typed `run_test` tool and no Git checkout, container, or external sandbox.
- The UI displays Flue's Durable Streams events while the response runs.

## Layout

```text
.
├── src/
│   ├── routes/+page.svelte                # Chat UI and event trace
│   └── routes/api/flue/[...path]/+server.ts
│                                            # Same-origin Flue proxy
├── agent/
│   ├── src/agents/assistant.ts             # Agent and run_test tool
│   ├── flue.config.ts
│   └── wrangler.jsonc                      # Flue Worker and DO migrations
├── turbo.json                              # Interactive two-process dev runner
└── wrangler.jsonc                          # SvelteKit Worker and service binding
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

Start both the Flue Worker and SvelteKit in Turborepo's interactive TUI:

```sh
pnpm dev
```

Use the arrow keys or `j`/`k` to switch tasks, `i` to interact with the selected process, `Ctrl+z` to stop interacting, and `m` to show all TUI keybindings.

Open the SvelteKit URL and choose **Test the tool**. Flue runs locally on port `3583`; the SvelteKit endpoint proxies `/api/flue/*` to it.

## How the durable thread works

The browser creates an agent instance ID and keeps it in `localStorage`. Flue maps that ID to one Durable Object, whose SQLite storage retains conversation state. **New thread** creates a different ID and therefore a fresh agent instance.

The browser submits with `client.agents.send(...)`, then reads from the receipt's exact offset with `client.agents.stream(...)`. The right-hand panel exposes the important events: durable admission, model turns, tool execution, token streaming, settlement, and idle.

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

Deploy the SvelteKit Worker after the `flue-sveltekit-agent` service exists:

```sh
pnpm deploy
```

The production SvelteKit Worker uses its `FLUE_AGENT` service binding. `FLUE_AGENT_URL` is only the local HTTP fallback.

## Production note

The demo intentionally leaves the Flue route unauthenticated. Add authentication and per-user agent IDs before exposing it as a real product.
