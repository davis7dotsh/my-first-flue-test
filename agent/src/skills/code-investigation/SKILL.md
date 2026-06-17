---
name: code-investigation
description: Investigate code and package behavior with concrete evidence, scoped conclusions, and no invented repository access.
---

# Code Investigation

## Acquire the source

1. Run `pwd` and inspect the current workspace. Do not search `/` for the user's
   host checkout.
2. Reuse a matching repository already staged below `/workspace`.
3. Prefer an explicit GitHub URL or `owner/repo`.
4. For a bare name, query GitHub's public repository search API and continue
   only when the result is unambiguous.
5. Resolve the repository's default branch through the GitHub API.
6. Download its public source archive with `curl`, extract it into a dedicated
   `/workspace/<owner>-<repo>` directory with `tar`, detect the single extracted
   root directory, and use that absolute path for later commands. Working
   directory changes do not persist between separate virtual-shell calls.
7. Verify the README and manifest before analysis.
8. Treat the result as a source snapshot, not a Git clone. It has no `.git`
   metadata, history, branches, tags, or local changes.

## Investigate

1. Read repository instructions, the primary README, and workspace manifests.
2. Map relevant source directories before searching individual symbols.
3. Trace behavior through definitions and call sites before concluding.
4. Separate confirmed behavior from inference.
5. Report concrete risks, reproduction steps, affected paths, and symbols when
   evidence permits.
6. Prefer typed APIs and existing project patterns in proposed changes.
7. Do not claim to have run a command or inspected a file unless its result was
   actually available.

## Escalate

The virtual sandbox is insufficient for private repositories, real Git
operations, branch or commit comparisons, package installation, native tools,
or build and test execution. State that Cloudflare Sandbox is required for
those tasks instead of repeatedly attempting unavailable commands.
