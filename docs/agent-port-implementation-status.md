# Agent Port Implementation Status

## Implemented

- Cloudflare Access JWT validation using the account JWKS, exact issuer, and AUD.
- Stable Access-subject to D1-user mapping.
- User-scoped thread creation, listing, loading, mutation, and proxy authorization.
- Immediate D1 tombstones and conditional message admission without claiming
  Flue session deletion.
- `research-agent` backed by Cloudflare-hosted Kimi K2.6 at low reasoning
  through the Workers AI binding and AI Gateway free allocation for testing.
- Per-user agent-submission rate limiting at the web Worker boundary.
- Private agent deployment configuration with `workers.dev` and preview URLs disabled.
- Self-contained researcher, code investigator, browser inspector, and reviewer profiles.
- Application-owned routing, citation, code-investigation, and long-task skills.
- Typed Firecrawl search/content and Context7 documentation tools with bounded
  provider reads, sanitized errors, and Worker-secret isolation.
- Content-free structured Flue lifecycle telemetry.
- Worker-runtime tests for Access validation, D1 ownership, legacy-row isolation,
  tombstones, conditional admission, proxy body limits, credential stripping,
  and proxy path authorization.

Flue Durable Object state remains the only canonical conversation transcript.
D1 stores authorization and rebuildable control-plane metadata only.

## Compatibility Spikes

These require a supported runtime path or a disposable deployed reproduction
before product behavior is added:

1. Accepted-submission cancellation and replay after reconnect.
2. Exact branch seeding or an explicitly reduced retry scope.
3. Addressable authenticated deletion of generated Flue session state, followed
   by an idempotent Queue cleanup consumer and D1 completion marker.
4. Exact quota settlement from durable, sanitized usage events.
5. Flue `1.0.0-beta.1` compatibility with the current Cloudflare Sandbox RPC
   transport, explicit sessions, matching image version, and restricted egress.

## Deferred Resources

The following require account resources, credentials, tenancy rules, deletion
behavior, or confirmed dependency compatibility:

- AI Search;
- Browser Run;
- Cloudflare Sandbox;
- R2 attachments and artifacts;
- Queue ingestion and projection reconciliation;
- Cloudflare Workflows and job UI;
- Exact quota settlement;
- Analytics Engine dashboards.

Do not port the source system's Redis transcript, Convex message transcript,
external Durable Streams sidecar, Upstash Box, Clerk, Autumn, UploadThing, or
Railway deployment topology.
