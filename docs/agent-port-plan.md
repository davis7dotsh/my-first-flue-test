# Cloudflare-First Flue Agent Port

## Objective

Port the research and code-investigation agent from
`/Users/davis/Developer/highmatter/hidden-btca-4` into this project while
removing its fragmented runtime and external infrastructure.

The target should:

- keep Flue as the agent harness;
- keep SvelteKit as the authenticated product surface;
- make one durable system authoritative for conversation and execution;
- run on Cloudflare except for Firecrawl and Context7;
- preserve streaming, replay, reasoning, tools, attachments, sandboxes, quotas,
  and long-running work;
- improve restart safety, deletion, authorization, observability, and testing.

## Source System Summary

The source agent currently splits responsibility across:

- a Bun/Effect/Pi agent service;
- OpenRouter for inference;
- Redis for canonical model transcripts;
- Convex for user-visible messages and run status;
- a Durable Streams sidecar for temporary replay;
- process memory for active-run discovery and cancellation;
- Upstash Box for command execution;
- UploadThing for attachments;
- Clerk for identity;
- Autumn for quota and billing;
- Railway for deployment;
- Raindrop and Axiom/OpenTelemetry for supporting infrastructure.

That split causes the known failure modes:

- edit and retry can rewind Convex without rewinding Redis;
- Redis can commit while Convex completion fails;
- a restart loses cancellation and active-run discovery;
- thread deletion leaks transcript, attachment, and sandbox state;
- cancellation does not reliably reach tools or external requests;
- billing can fail after work has already completed;
- there are no automated restart, replay, cancellation, or transcript-integrity
  tests.

## Architecture Decision

Keep the existing two-Worker topology:

```text
Browser
  |
  v
SvelteKit web Worker
  - Cloudflare Access identity
  - D1 authorization and control plane
  - R2 upload/download gateway
  - quota admission
  |
  | service binding
  v
Flue agent Worker
  - private Flue routes
  - per-thread generated Durable Object
  - Workers AI through AI Gateway
  - tools, skills, profiles, and sandbox
  - Queue and Workflow integration
```

The Flue-generated per-thread Durable Object is the canonical authority for:

- conversation history;
- accepted submissions and ordering;
- reasoning, message, and tool events;
- durable replay offsets;
- interruption reconciliation;
- model and tool execution outcomes.

D1 must never contain a second canonical transcript.

## State Ownership

| State                              | Authority                  | Notes                                  |
| ---------------------------------- | -------------------------- | -------------------------------------- |
| Conversation and execution events  | Flue Durable Object SQLite | Never dual-written to D1               |
| Thread ownership and active branch | D1                         | Security and product control plane     |
| Sidebar title and status           | D1 projection              | Rebuildable from Flue events           |
| Quota reservations and settlements | D1                         | Idempotent by submission or job ID     |
| Attachment and artifact bytes      | R2                         | Namespaced by owner and logical thread |
| Attachment extraction index        | AI Search                  | Derived and disposable                 |
| Long-job checkpoints and approvals | Cloudflare Workflows       | Durable step orchestration             |
| Aggregate operational metrics      | Analytics Engine           | Not authoritative for billing          |
| Model request logs and controls    | AI Gateway                 | Account-level safety and visibility    |

Projection lag must not affect the conversation. A reconciliation process should
be able to replay a Flue event stream and rebuild D1 list projections.

## Cloudflare Primitive Map

### Use

| Primitive                      | Responsibility                                                               |
| ------------------------------ | ---------------------------------------------------------------------------- |
| Workers                        | Web and agent compute                                                        |
| Service bindings               | Private web-to-agent communication                                           |
| Flue-generated Durable Objects | Continuing sessions, queueing, replay, recovery                              |
| D1                             | Identity mapping, authorization, threads, branches, quotas, jobs, tombstones |
| R2                             | Attachments, screenshots, reports, and durable artifacts                     |
| R2 event notifications         | Start attachment ingestion after upload                                      |
| Queues                         | Idempotent ingestion, projection updates, cleanup, and reconciliation        |
| Workflows                      | Multi-step jobs, retries, waits, approvals, and cleanup                      |
| Workers AI                     | Cloudflare-hosted inference, embeddings, reranking, and safety tasks         |
| AI Gateway                     | Model telemetry, caching where safe, rate controls, and circuit breaking     |
| AI Search                      | Private uploaded and generated knowledge corpus                              |
| Browser Run                    | Rendered pages, interaction, screenshots, and visual inspection              |
| Sandbox SDK                    | Isolated Linux, repositories, packages, commands, and generated files        |
| Secrets Store                  | Firecrawl and Context7 credentials                                           |
| Access                         | Workforce/internal identity perimeter                                        |
| Rate Limiting binding          | Per-user, per-route, and per-tier burst controls                             |
| Turnstile                      | Abuse protection on any public enrollment or unauthenticated surface         |
| Workers Observability          | Structured logs and traces                                                   |
| Analytics Engine               | High-cardinality agent and tool metrics                                      |

### Do Not Use Initially

| Primitive                            | Reason                                                             |
| ------------------------------------ | ------------------------------------------------------------------ |
| Direct Vectorize                     | AI Search already owns the managed retrieval stack                 |
| KV                                   | No low-consistency state currently justifies another store         |
| Cache API                            | Tool-result caching needs explicit freshness rules first           |
| A second coordination Durable Object | Flue already owns per-thread coordination                          |
| Raw Containers                       | Sandbox SDK is the supported lifecycle and isolation layer         |
| Tail Workers                         | Native logs plus direct sanitized metrics are sufficient initially |
| Pipelines                            | Add only if long-term event export to R2 becomes necessary         |
| Workers for Platforms                | No customer-authored Worker deployment requirement                 |
| Hyperdrive                           | No external SQL database remains                                   |

## Agent Composition

### Main Agent

Create `agent/src/agents/research-agent.ts`.

The main agent should:

- own the continuing user conversation;
- decide which specialist or tool is appropriate;
- produce grounded answers with source attribution;
- keep external side effects behind bounded tools;
- escalate durable multi-step work to a Cloudflare Workflow.

Model strategy:

- launch default for the main agent and specialist profiles:
  `cloudflare/openai/gpt-5.5`;
- use low reasoning effort for agent model calls;
- use structured results for classifications, plans, and workflow handoffs;
- route all model calls through a named AI Gateway.

Benchmark GPT-5.5 against representative source-agent tasks before production
launch and change the default only from measured results. Do not restore
OpenRouter as an unmeasured fallback.

### Profiles

Add self-contained Flue profiles:

- `researcher`: source discovery and synthesis;
- `code-investigator`: repository and package analysis in Sandbox;
- `browser-inspector`: rendered or interactive web investigation;
- `reviewer`: read-only evidence and correctness review.

Each profile should receive only the tools and skills it needs. Parent tools must
not be assumed to flow into subagents.

### Skills

Add application-owned skills for:

- research routing and source priority;
- citation and evidence requirements;
- codebase investigation;
- attachment and private-corpus use;
- long-running task escalation;
- final answer review.

### Tool Routing Policy

The prompt and skill policy should enforce this order:

1. Use Context7 for named library, framework, and API documentation.
2. Use AI Search for user-uploaded or application-owned material.
3. Use Firecrawl for broad web search, crawl, map, scrape, and extraction.
4. Use Browser Run when JavaScript rendering, interaction, screenshots, or
   visual inspection are required.
5. Use Sandbox for repositories, packages, commands, file transformations, and
   generated artifacts.
6. Do not expose a general raw-fetch tool or a secret-bearing shell.

Firecrawl and Context7 should be wrapped in narrow typed tools or trusted MCP
connections created by Worker code. Their credentials must never enter model
context or the sandbox environment.

### Sandbox Policy

Use Cloudflare Sandbox only when a task requires a real Linux environment.
Simple research turns should not start a container.

Required configuration:

- RPC transport;
- `enableDefaultSession: false`;
- explicit command sessions;
- stable workspace identity tied to the logical branch or task;
- application-controlled timeouts and cleanup;
- an outbound Worker that denies by default and allows required hosts;
- credentials injected by the outbound Worker, not placed in the container;
- important outputs copied to R2 before sandbox cleanup.

Use custom Browser Run tools rather than Agents SDK `0.16.x` browser helpers
until Flue declares support beyond its tested `agents@0.14.x` dependency line.

## Core Flows

### Normal Prompt

1. Access authenticates the browser request.
2. The web Worker resolves the Access subject to a D1 user.
3. D1 verifies logical-thread ownership and the active Flue instance.
4. The Rate Limiting binding checks burst limits.
5. D1 atomically reserves quota with an idempotency key.
6. Ready image attachments are read from R2 and sent as Flue image inputs.
7. The web Worker sends the prompt over the service binding.
8. The client follows the Flue stream from the returned admission offset.
9. Sanitized completion and usage events update D1 projections and quota
   settlement asynchronously.

### Refresh and Replay

1. Load the logical thread and active Flue instance from D1.
2. Load a browser checkpoint if present.
3. Replay the Flue stream from that offset, or from `-1`.
4. Treat `message_end` and settlement events as authoritative.
5. Keep browser caches disposable.

For very long histories, add a rebuildable presentation snapshot with its Flue
offset. The snapshot is an optimization, not transcript authority.

### Cancellation

Current Flue `1.0.0-beta.1` does not expose true cancellation of an already
accepted direct submission.

The initial design can:

- persist a cancellation request in D1;
- stop client streaming;
- terminate associated Workflows and Browser Run sessions;
- abort Sandbox commands and trusted external fetches;
- make every custom tool check the durable cancellation flag;
- prevent subsequent side effects.

It cannot promise immediate cancellation of an in-flight Workers AI call or the
internal Flue turn. This is a launch limitation, not something to hide behind a
UI label.

### Attachments

1. The web Worker streams an upload into R2.
2. D1 records owner, thread, media type, size, checksum, and ingestion status.
3. R2 event notification emits to a Queue.
4. The consumer validates and extracts content.
5. Documents are indexed into a per-user or per-thread AI Search scope.
6. Images remain available for direct vision inputs and Browser Run inspection.
7. The attachment becomes selectable only after validation succeeds.

### Edit and Retry

Never mutate or partially rewind an existing Flue conversation.

Model edit/retry as an immutable branch:

1. Select a canonical event boundary.
2. Create a new branch record and new Flue instance ID.
3. Seed the new branch with a bounded trusted context artifact.
4. Send the edited user message to the new instance.
5. Atomically switch D1's active branch after successful admission.

Exact branch seeding is a required feasibility spike. The public Flue SDK does
not currently expose arbitrary transcript import. Until a supported seeding
path is proven, ship retry-from-current-state and new-thread behavior rather
than pretending to provide exact rewind.

### Deletion

1. Write a D1 tombstone so new requests fail immediately.
2. Request cooperative cancellation and stop new admissions.
3. Wait for the Flue session to become idle.
4. Delete Flue session state through a supported runtime path.
5. Delete R2 attachments and artifacts.
6. Delete AI Search documents and sandbox state.
7. Remove projections and quota reservations, retaining only required audit
   records.

Deleting an addressable Flue session through the generated Cloudflare runtime
needs a feasibility spike. Flue exposes `session.delete()` inside a harness but
does not document a public agent-delete SDK endpoint.

### Long-Running Task

Use a Cloudflare Workflow when work needs step checkpoints, retries, waits,
approval, or execution longer than an ordinary turn.

1. A bounded agent tool creates the Workflow with an idempotency key.
2. D1 records the job and owning thread.
3. Workflow steps call trusted tools or bounded Flue operations.
4. Progress is written to D1 and surfaced as job UI, not forged as chat history.
5. Approval uses `waitForEvent` or the Agents/Workflows approval integration
   available on the supported dependency line.
6. Completion sends one idempotent result back to the continuing agent.

### Failure and Restart

- Flue reconciles accepted agent submissions from Durable Object SQLite.
- Workflows resume at durable step boundaries.
- Queues redeliver, so every consumer must deduplicate.
- D1 quota and projection writes use submission or job IDs.
- Tool side effects use application-owned idempotency keys.
- Unknown tool outcomes are reported as unknown and are not blindly replayed.
- D1 projections are rebuilt by replaying Flue events.

## Security

### Identity

Use Cloudflare Access JWT validation for an internal or workforce deployment.
Map the stable Access subject to a D1 user row and authorize every thread,
attachment, job, stream, and deletion request.

Access is not a complete consumer identity replacement for Clerk. A public
consumer product would require a separate identity decision and would violate
the current "Cloudflare plus Firecrawl and Context7 only" boundary.

### Agent Isolation

- Keep the agent Worker private behind a service binding.
- Disable public `workers.dev` access for the agent Worker.
- Validate the requested thread and agent name in the web proxy.
- Do not trust model-selected tenant IDs, object keys, URLs, or credentials.
- Scope every tool with trusted owner and thread context.

### Secrets and Egress

- Store Firecrawl and Context7 credentials in Secrets Store.
- Resolve credentials in trusted Worker code.
- Use service bindings for Cloudflare services rather than REST APIs.
- Use a deny-by-default outbound Worker for Sandbox traffic.
- Log destinations and policy decisions, but redact credentials and content.

### Quotas and Cost

- Reserve quota in D1 before admission.
- Settle exact usage once per submission.
- Reconcile abandoned reservations.
- Use Rate Limiting for burst control.
- Use AI Gateway for model visibility and account-level circuit breaking.
- Keep Analytics Engine out of authoritative quota decisions.

Cloudflare does not provide a direct subscription and payment replacement for
Autumn. The Cloudflare-only launch should be internal, invite-only, or
noncommercial unless that external-service boundary changes.

## Observability

Register a lightweight Flue `observe()` callback in the agent application.

Emit:

- submission admission and settlement;
- model latency, tokens, and reported cost;
- tool latency and outcome;
- Workflow and Queue IDs;
- sandbox and browser session lifecycle;
- cancellation request and observed cancellation lag;
- replay counts and projection lag;
- attachment ingestion duration;
- quota reservation and settlement mismatch.

Destinations:

- Workers Logs and tracing for detailed operational debugging;
- Analytics Engine for aggregates;
- D1 for exact usage and idempotency records;
- AI Gateway for model-call inspection and controls.

Sanitize prompts, model messages, tool inputs, tool outputs, and attachment
metadata before exporting telemetry.

## Testing

Add tests before feature parity is declared.

### Unit

- Access identity extraction and ownership checks;
- research routing policy;
- tool schemas and authorization closure;
- quota reservation and settlement;
- event reduction into conversation items;
- attachment validation;
- branch context generation;
- telemetry redaction.

### Worker Integration

- D1 migrations and transactions;
- R2 upload and deletion;
- R2 event to Queue ingestion;
- Queue duplicate delivery;
- Flue prompt admission and durable replay;
- service-binding authorization;
- Workflow retry and approval;
- Sandbox lifecycle and egress denial;
- projection failure followed by replay rebuild.

### Fault Injection

- Worker restart after admission;
- restart during model streaming;
- restart after tool side effect but before recorded completion;
- duplicate queue message;
- D1 projection failure;
- R2 cleanup failure;
- Workflow retry after an external timeout;
- sandbox eviction;
- cancellation during each tool class.

### Browser End-to-End

- prompt and streamed reasoning;
- refresh during generation;
- reconnect from a saved offset;
- attachment upload and use;
- cooperative cancellation messaging;
- retry and branch behavior;
- deletion and access denial.

## Proposed File Layout

```text
agent/
├── Dockerfile
├── src/
│   ├── agents/
│   │   └── research-agent.ts
│   ├── profiles/
│   │   ├── browser-inspector.ts
│   │   ├── code-investigator.ts
│   │   ├── researcher.ts
│   │   └── reviewer.ts
│   ├── skills/
│   │   ├── citation-review/
│   │   ├── code-investigation/
│   │   ├── research-routing/
│   │   └── long-task/
│   ├── tools/
│   │   ├── ai-search.ts
│   │   ├── browser-run.ts
│   │   ├── context7.ts
│   │   ├── firecrawl.ts
│   │   ├── jobs.ts
│   │   └── cancellation.ts
│   ├── workflows/
│   │   ├── attachment-ingestion.ts
│   │   ├── branch-thread.ts
│   │   ├── delete-thread.ts
│   │   └── long-research.ts
│   ├── app.ts
│   ├── cloudflare.ts
│   └── observability.ts
├── flue.config.ts
└── wrangler.jsonc

src/
├── lib/server/
│   ├── access.ts
│   ├── attachments.ts
│   ├── quotas.ts
│   ├── threads.ts
│   └── usage.ts
└── routes/api/
    ├── attachments/
    ├── jobs/
    ├── threads/
    └── flue/[...path]/

migrations/
├── 0003_agent_control_plane.sql
├── 0004_attachments.sql
├── 0005_usage_quotas.sql
└── 0006_jobs_projections.sql
```

Cloudflare Workflow classes may need to live in `agent/src/cloudflare.ts` or in
modules re-exported from it rather than in Flue's `src/workflows/` convention.
Flue workflows are not step-resumable and must not be confused with Cloudflare
Workflows.

## Delivery Phases

### Phase 0: Compatibility Spikes

Prove before broad implementation:

- Workers AI tool calling and reasoning events through Flue;
- private service-binding-only deployment;
- supported Flue session deletion path;
- branch seeding or an explicit reduced edit/retry scope;
- cooperative cancellation behavior;
- Flue plus Cloudflare Sandbox version compatibility;
- AI Search tenant filtering and deletion behavior.

Acceptance:

- each spike has a minimal automated reproduction;
- unsupported behavior is removed from launch scope rather than emulated
  unsafely.

### Phase 1: Cloudflare-Native Conversation

- rename the demo agent to `research-agent`;
- switch to Workers AI through a named AI Gateway;
- add Access identity validation;
- replace anonymous owner cookies with D1 user ownership;
- keep the existing service binding and Flue replay UI;
- add D1 quota reservation and exact settlement;
- remove public agent access.

Acceptance:

- no OpenRouter key;
- authenticated prompt, refresh, and replay work;
- a Worker restart does not lose an admitted prompt;
- D1 contains no canonical message transcript.

### Phase 2: Research Harness

- add profiles, skills, and bounded tools;
- integrate Context7 and Firecrawl from trusted Worker code;
- add AI Search for private material;
- add Browser Run;
- add lazy Cloudflare Sandbox with restricted egress.

Acceptance:

- representative source-agent tasks complete using the routing policy;
- no secret appears in model, event, log, or sandbox output;
- reasoning and tool events replay after refresh;
- simple turns do not start a sandbox.

### Phase 3: Attachments and Artifacts

- add R2 uploads and D1 metadata;
- add Queue-driven validation and extraction;
- index documents into AI Search;
- pass images as vision inputs;
- persist generated artifacts to R2.

Acceptance:

- duplicate Queue delivery is harmless;
- deleted attachments become inaccessible immediately;
- ingestion status survives Worker restarts;
- agent tools can only access attachments owned by the active user.

### Phase 4: Durable Jobs and Lifecycle

- add Cloudflare Workflows for long research, branch preparation, and cleanup;
- add job UI and approval events;
- implement the proven deletion path;
- implement the proven branch scope;
- add projection reconciliation.

Acceptance:

- Workflow retry does not duplicate side effects;
- deletion removes all reachable thread data;
- projection rebuild produces the same visible conversation;
- unsupported exact rewind is clearly absent from the UI.

### Phase 5: Verification and Hardening

- add unit, Worker integration, fault-injection, and browser tests;
- add structured logs, tracing, Analytics Engine metrics, and dashboards;
- add quota reconciliation and cleanup schedules;
- benchmark Workers AI models against the source agent;
- document retention and incident procedures.

Acceptance:

- restart and duplicate-delivery tests pass;
- quota mismatch alarms are actionable;
- no known transcript dual-write remains;
- production validation uses only Cloudflare, Firecrawl, and Context7 services.

## Primary Risks

- Flue is still beta and its persisted schema is a hard migration boundary.
- Flue currently targets Agents SDK `0.14.x`; newer SDK features cannot be
  assumed compatible.
- Accepted-submission cancellation is cooperative rather than immediate.
- Exact edit/retry branching may be blocked by missing transcript import APIs.
- Addressable session deletion needs a supported runtime entry point.
- AI Search ingestion is asynchronous and may not suit immediate prompt context.
- Sandbox lifecycle and egress policy need production testing.
- Flue event retention can grow without bound and needs an explicit retention
  plan.
- Access and D1 quotas replace Clerk and Autumn only for an internal or
  noncommercial deployment.

## Definition of Done

The port is complete when:

- Flue Durable Object state is the only canonical conversation record;
- all infrastructure except Firecrawl and Context7 is Cloudflare-native;
- prompts, tools, reasoning, refresh, and replay survive restart;
- attachments and artifacts are authorized and fully deletable;
- long jobs are resumable and idempotent;
- quota enforcement is exact and reconciled;
- no secret reaches the model or sandbox;
- failure injection proves there is no duplicate side effect or transcript
  divergence;
- unsupported cancellation or branching behavior is represented honestly in
  the product.
