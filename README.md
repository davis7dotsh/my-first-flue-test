# Flue + SvelteKit demo

A deliberately small stateful agent stack on Cloudflare:

- SvelteKit renders the chat UI as a Cloudflare Worker.
- A second Worker runs a Flue agent backed by Durable Objects.
- A Cloudflare service binding connects the SvelteKit Worker to the agent Worker.
- Cloudflare Access authenticates requests and D1 stores the user-owned thread control plane.
- Workers AI provides the model through AI Gateway, so there is no external model API key.
- The agent has evidence-first profiles, application-owned skills, and one typed runtime-check tool.
- The UI displays Flue's Durable Streams events while the response runs.

## Layout

```text
.
├── src/
│   ├── hooks.server.ts                     # Access JWT validation and D1 user resolution
│   ├── lib/components/ChatThread.svelte   # Durable replay and live chat UI
│   ├── routes/chat/[id]/+page.svelte      # Thread URL
│   ├── routes/api/threads/+server.ts      # D1 thread index API
│   └── routes/api/flue/[...path]/+server.ts
│                                           # Authorized same-origin Flue proxy
├── agent/
│   ├── src/agents/research-agent.ts        # Durable research agent
│   ├── src/profiles/                       # Self-contained specialist profiles
│   ├── src/skills/                         # Application-owned agent skills
│   ├── flue.config.ts
│   └── wrangler.jsonc                      # Flue Worker and DO migrations
├── migrations/                             # D1 users and thread control plane
├── turbo.json                              # Interactive two-process dev runner
└── wrangler.jsonc                          # Web Worker, service, and D1 bindings
```

## Environment variables

Copy the root example to `.env` for local web development:

```sh
cp .env.example .env
```

| Variable                | Where                      | Purpose                                                                |
| ----------------------- | -------------------------- | ---------------------------------------------------------------------- |
| `FLUE_AGENT_URL`        | Root `.env`, local only    | Sends the SvelteKit proxy to the locally running Flue agent.           |
| `CF_ACCESS_TEAM_DOMAIN` | Root `.env` and web Worker | Cloudflare Access issuer, such as `https://team.cloudflareaccess.com`. |
| `CF_ACCESS_AUD`         | Root `.env` and web Worker | Audience tag for the Access application protecting the web Worker.     |
| `AI_GATEWAY_ID`         | Agent Wrangler config      | AI Gateway ID used by the Workers AI provider.                         |

For the deployed web Worker, add `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD`
under **Workers & Pages > flue-sveltekit-demo > Settings > Variables and
Secrets**. Do not set `FLUE_AGENT_URL` in production; the Worker uses the
`FLUE_AGENT` service binding instead.

The agent needs no model API key. Its `AI` binding and default
`AI_GATEWAY_ID=default` are already configured in `agent/wrangler.jsonc`. Copy
`agent/.dev.vars.example` to `agent/.dev.vars` only when you want a local
gateway override:

```sh
cp agent/.dev.vars.example agent/.dev.vars
```

`THREADS_DB`, `FLUE_AGENT`, and `AI` are Wrangler bindings, not environment
variables. They are already declared in the two `wrangler.jsonc` files.

## Run locally

Install dependencies once:

```sh
pnpm install
```

Set `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` in `.env` to a real Access
application before making requests. Authentication fails closed when either
value or the `Cf-Access-Jwt-Assertion` header is missing. Setting the variables
does not bypass Access: a plain localhost request without a valid assertion
still receives `403 Forbidden`.

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

The web Worker validates the Cloudflare Access JWT, resolves its stable subject
to a D1 user, and creates each thread with that user, a title, timestamps, and
the `research-agent` agent name. The thread ID is also the Flue instance ID, so
each D1 row points to one Durable Object-backed conversation.

Flue remains the only source of truth for conversation content. D1 contains
authorization and list projections, not a second transcript. Opening
`/chat/:id` replays the agent event stream from offset `-1` and keeps the stream
live. A refresh during generation therefore rebuilds completed history and
continues receiving the in-flight response.

Thread deletion currently writes an immediate D1 tombstone and returns
`202 Accepted`. It does not claim to delete the generated Flue Durable Object;
that lifecycle operation remains a compatibility spike.

## Check the project

```sh
pnpm typegen
pnpm agent:typegen
pnpm test
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

## Production notes

- Put the web Worker behind the Access application whose issuer and AUD are
  configured in the Worker environment.
- The agent Worker disables `workers.dev` and preview URLs and is reached through
  the web Worker's service binding.
- AI Gateway content logging is disabled until a retention and access policy is
  defined.
- See `docs/agent-port-implementation-status.md` for implemented scope and
  remaining feasibility work.
