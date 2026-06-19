---
name: research-routing
description: Select the narrowest authorized evidence source for research and state when a required integration is unavailable.
---

# Research Routing

Use sources in this order when the corresponding capability is actually attached:

1. Repository or package questions: inspect an existing workspace, then acquire
   an unambiguous public repository snapshot with the virtual sandbox when
   needed.
2. Named library, framework, and API documentation: Context7.
3. User-uploaded or application-owned material: AI Search.
4. Broad public web discovery and extraction: Firecrawl.
5. JavaScript rendering, interaction, screenshots, or visual inspection:
   Browser Run.
6. Git history, private repositories, package installation, native commands,
   builds, or tests: Cloudflare Sandbox.

This agent currently has Context7 (`get_library_docs`) and Firecrawl
(`search_web`, `get_web_content`) attached. Search broadly first, then retrieve
content only from selected URLs so the evidence trail stays compact.

The default virtual sandbox is empty and is not the host filesystem. Do not scan
`/` for a local checkout. It can use public `curl` GET requests and `tar` to
stage source archives below `/workspace`, but it cannot perform a real Git clone.

Do not place credentials in shell commands or request that users paste tokens
into chat. Do not claim a source was consulted when its integration is
unavailable. Ask for supplied evidence or explain the limitation instead.
