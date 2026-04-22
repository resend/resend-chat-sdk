# Changelog

## 0.2.2

### Patch Changes

- cb1a144: Forward `WebhookOptions` through `ResendAdapter.handleWebhook` to `chat.processMessage`. `processMessage` is fire-and-forget, so on serverless platforms (e.g. Vercel Functions) the function would return 200 before the detached task finished — inbound emails were acknowledged but never processed. Callers can now pass `waitUntil` to keep the runtime alive until processing completes:

  ```ts
  import { after } from "next/server";

  adapter.handleWebhook(request, { waitUntil: (p) => after(() => p) });
  ```

## 0.2.1

### Patch Changes

- 69ab8c9: Fix streamed email delivery and markdown rendering in `postMessage`.

  - `thread.post(asyncIterable)` (AI SDK `textStream` / `fullStream`, or any `AsyncIterable<string | StreamChunk>`) now buffers the full stream and sends a single final email. Previously the Chat SDK's default post+edit fallback kicked in, which sent a placeholder email immediately and then failed on edit (email is immutable, so `editMessage` is not supported).
  - **Behavior change**: `postMessage(threadId, { markdown })` now renders the markdown to HTML and a plain-text body. Previously the raw markdown string was sent verbatim as the email's text body with no HTML. If you were relying on the old behavior, pass a plain string (`postMessage(threadId, "**literal**")`) or `{ raw }` instead.
  - Streams that yield no textual content (e.g. only `task_update` / `plan_update` chunks) now throw instead of silently sending a blank email.

## 0.2.0

### Minor Changes

- 714f08d: Upgrade to `react-email@^6.0.0`. Replaces `@react-email/components` and `@react-email/render` with the unified `react-email` package. Bumps minimum Node to `>=20` (required by react-email 6).

## 0.1.1

### Patch Changes

- 7a49c56: Add `channelIdFromThreadId()` and align the adapter's async method signatures with the current Chat SDK contract.

## 0.1.0 (2025-02-27)

Initial release.

### Features

- Bidirectional email adapter for the Vercel Chat SDK using Resend
- Inbound email handling via Resend webhooks with signature verification
- Outbound email sending via Resend API
- Email-native threading using `Message-ID` / `In-Reply-To` / `References` headers
- Card rendering via `@react-email/components` for styled HTML emails
- DM support via `openDM(emailAddress)`
- Factory function `createResendAdapter()` for quick setup
