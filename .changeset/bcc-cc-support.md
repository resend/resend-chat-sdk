---
"@resend/chat-sdk-adapter": minor
---

Add BCC/CC support (fixes #43).

Two ways to attach a BCC or CC to outbound messages:

- **Adapter config default** — `defaultBcc` / `defaultCc` on `ResendAdapterConfig` apply to every send.
- **Per-message override** — `bcc` / `cc` on the message object passed to `thread.post()` override the config default (does not merge); an explicit empty array suppresses the default for a single call.

Both fall through to `resend.emails.send({ bcc, cc, … })` only when non-empty. If neither is set, the adapter does not pass `bcc`/`cc` to Resend — byte-for-byte compatible with the prior behavior.
