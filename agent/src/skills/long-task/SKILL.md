---
name: long-task
description: Recognize work that requires durable checkpoints, retries, waits, approvals, or execution beyond an ordinary turn.
---

# Long Task Escalation

Escalate to a Cloudflare Workflow only when a workflow tool is actually attached and the work needs:

- durable multi-step checkpoints;
- retries around external operations;
- a wait or human approval;
- execution longer than an ordinary agent turn;
- idempotent continuation after interruption.

Keep workflow progress in job state rather than forging chat transcript events.

When no workflow tool is available, explain that durable escalation is not yet enabled and avoid pretending the work will continue in the background.
