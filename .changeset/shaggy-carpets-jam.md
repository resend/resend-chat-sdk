---
"@resend/chat-sdk-adapter": patch
---

Fix streamed email delivery and markdown rendering in `postMessage`.

- `thread.post(asyncIterable)` (AI SDK `textStream` / `fullStream`, or any `AsyncIterable<string | StreamChunk>`) now buffers the full stream and sends a single final email. Previously the Chat SDK's default post+edit fallback kicked in, which sent a placeholder email immediately and then failed on edit (email is immutable, so `editMessage` is not supported).
- **Behavior change**: `postMessage(threadId, { markdown })` now renders the markdown to HTML and a plain-text body. Previously the raw markdown string was sent verbatim as the email's text body with no HTML. If you were relying on the old behavior, pass a plain string (`postMessage(threadId, "**literal**")`) or `{ raw }` instead.
- Streams that yield no textual content (e.g. only `task_update` / `plan_update` chunks) now throw instead of silently sending a blank email.
