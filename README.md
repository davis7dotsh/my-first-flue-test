# Flue + SvelteKit demo

A deliberately small stateful agent stack on Cloudflare:

- SvelteKit renders the chat UI as a Cloudflare Worker.
- A second Worker runs a Flue agent backed by Durable Objects.
- A Cloudflare service binding connects the SvelteKit Worker to the agent Worker.
- Cloudflare Access authenticates requests and D1 stores the user-owned thread control plane.
- Cloudflare Workers AI runs Kimi K2.6 through AI Gateway, so there is no
  external model API key or Unified Billing balance requirement.
- The agent has evidence-first profiles, application-owned skills, a typed runtime check,
  Firecrawl web research tools, and Context7 library-documentation retrieval.
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
| `AI_GATEWAY_ID`         | Agent Wrangler config      | AI Gateway ID used by the Cloudflare AI binding.                       |
| `FIRECRAWL_API_KEY`     | Agent `.dev.vars`/secret   | Authenticates `search_web` and `get_web_content`.                      |
| `CONTEXT7_API_KEY`      | Agent `.dev.vars`/secret   | Authenticates `get_library_docs`.                                      |

For the deployed web Worker, add `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD`
under **Workers & Pages > flue-sveltekit-demo > Settings > Variables and
Secrets**. Do not set `FLUE_AGENT_URL` in production; the Worker uses the
`FLUE_AGENT` service binding instead.

The agent needs no model API key. Its `AI` binding and dedicated production
`AI_GATEWAY_ID=flue-sveltekit-demo` are configured in `agent/wrangler.jsonc`.
Copy `agent/.dev.vars.example` to `agent/.dev.vars` and fill in the two trusted
research-provider credentials before using the research tools locally:

```sh
cp agent/.dev.vars.example agent/.dev.vars
```

Set the same credentials as encrypted Worker secrets for production:

```sh
pnpm --dir agent exec wrangler secret put FIRECRAWL_API_KEY
pnpm --dir agent exec wrangler secret put CONTEXT7_API_KEY
```

The keys are read only by trusted Worker tool code. They are not model
arguments and are never copied into the virtual workspace or shell environment.

`THREADS_DB`, `FLUE_AGENT`, `AI_SUBMISSION_RATE_LIMITER`, and `AI` are Wrangler
bindings, not environment variables. They are already declared in the two
`wrangler.jsonc` files. Agent submissions are limited to 10 per authenticated
user per minute before they reach the private Worker.

The current testing model is `@cf/moonshotai/kimi-k2.6` at low reasoning. It is
covered by Workers AI's daily free allocation; requests fail after that
allowance is exhausted unless the account is on Workers Paid.

## Run locally

Install dependencies once:

```sh
pnpm install
```

Vite binds the SvelteKit development server to `127.0.0.1` by default, so open
`http://127.0.0.1:5173` (or `http://localhost:5173` when `localhost` resolves to
IPv4). The app assigns one stable development identity only when both the
request hostname and client address are loopback. All production and
non-loopback requests still fail closed when the Access configuration or
`Cf-Access-Jwt-Assertion` header is missing or invalid.

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

The current Flue SDK can abort the HTTP request while a submission is being
admitted and can cancel a client event-stream reader, but it does not expose an
API that cancels an already-admitted durable agent submission. The UI therefore
does not present a misleading Stop button: closing the stream would only hide
progress while the model run continued server-side. Add Stop only after Flue
provides a durable cancellation endpoint with an observable terminal event.

Thread deletion currently writes an immediate D1 tombstone and returns
`202 Accepted`. It does not claim to delete the generated Flue Durable Object;
that lifecycle operation remains a compatibility spike. The intended lifecycle
is an idempotent Queue job that retries Flue session deletion and marks D1
cleanup complete once the Durable Object state is erased. The queue should not
be added until Flue exposes authenticated addressable session deletion.

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
- Configure the test gateway with a global $5/day spend limit. The Worker-side
  limiter controls submission bursts; the gateway limit bounds aggregate model
  spend across retries and subagents.
- See `docs/agent-port-implementation-status.md` for implemented scope and
  remaining feasibility work.
