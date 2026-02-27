# Resend Chat SDK Adapter — Design Document

## Overview

`@chat-adapter/resend` bridges email (via Resend) into Vercel's Chat SDK unified interface. Bidirectional: inbound emails arrive via Resend webhooks and trigger Chat SDK event handlers; outbound messages sent as emails via Resend API.

## Architecture

```
                    ┌──────────────────────────────┐
                    │         Chat SDK             │
                    │  (ChatInstance, Thread, etc.) │
                    └──────────┬───────────────────┘
                               │
                    ┌──────────▼───────────────────┐
                    │      ResendAdapter           │
                    │  implements Adapter<          │
                    │    ResendThreadId,            │
                    │    ResendRawMessage>          │
                    └──┬────────────────────────┬──┘
                       │                        │
            ┌──────────▼──────────┐  ┌──────────▼──────────┐
            │  Inbound (webhook)  │  │  Outbound (send)    │
            │  webhook-handler.ts │  │  adapter.postMessage │
            │  message-parser.ts  │  │  message-renderer.ts │
            └──────────┬──────────┘  │  card-renderer.tsx   │
                       │             └─────────────────────┘
                       │
            ┌──────────▼──────────┐
            │  thread-resolver.ts │
            │  (ID generation,    │
            │   header tracking)  │
            └─────────────────────┘
```

## Key Design Decisions

### 1. Thread ID Format

```
resend:{to-address}:{sha256-hash-16-chars}
```

- `to-address`: First recipient email (the "channel" identifier)
- Hash: SHA-256 of the root `Message-ID` header, truncated to 16 hex chars
- Hash→original Message-ID mapping stored via Chat SDK state adapter

Thread grouping uses standard email headers: `Message-ID`, `In-Reply-To`, `References`.

### 2. All Inbound Emails = Mentions

Every received email triggers Chat SDK processing:
- **New thread** (no `In-Reply-To`): `processMessage` with `isMention: true`
- **Reply** (has `In-Reply-To`): `processMessage` on existing thread

No concept of "non-mention" emails — the bot is always directly addressed.

### 3. Card Rendering via react-email

| Card Component | react-email Component |
|---|---|
| `<card>` | `<Section>` |
| `<card.header>` | `<Heading>` |
| `<card.body>` | `<Section>` |
| `<card.text>` | `<Text>` |
| `<card.button>` | `<Button>` |
| `<card.image>` | `<Img>` |
| `<card.divider>` | `<Hr>` |
| `<card.link>` | `<Link>` |

`render()` from `@react-email/render` produces XHTML Transitional HTML.

### 4. NotImplementedError for Unsupported Features

`editMessage`, `deleteMessage`, `addReaction`, `removeReaction`, `startTyping` all throw `NotImplementedError` from `@chat-adapter/shared`.

### 5. Format Converter

`ResendFormatConverter` extends `BaseFormatConverter`:
- `fromAst(ast: Root): string` — mdast → HTML (for email body)
- `toAst(text: string): Root` — plain text/HTML → mdast (for inbound)

### 6. DM Semantics

`openDM(emailAddress)` creates new thread to given address. Thread ID uses generated `Message-ID` as root.

### 7. Message Rendering Pipeline

1. `AdapterPostableMessage` → check for Card via `extractCard()`
2. Card → `card-renderer.tsx` → HTML; Text/formatted → `format-converter` → HTML
3. Generate plain text fallback
4. Resolve thread headers (`In-Reply-To`, `References`, `Subject`)
5. `resend.emails.send({ from, to, subject, html, text, headers })`

### 8. Webhook Verification

Svix-based: `resend.webhooks.verify({ payload, headers: { id, timestamp, signature }, webhookSecret })`

Only `email.received` events processed. Others acknowledged (200) but ignored.

## Type Definitions

```typescript
interface ResendThreadId {
  toAddress: string;
  rootMessageIdHash: string;
}

interface ResendRawMessage {
  id: string;              // Resend email ID
  messageId: string;       // RFC 822 Message-ID header
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
  attachments?: ResendAttachment[];
  createdAt: string;
}

interface ResendAttachment {
  filename: string;
  contentType: string;
  url?: string;            // Download URL (inbound)
  content?: string;        // Base64 content (outbound)
}

interface ResendAdapterConfig {
  apiKey?: string;          // RESEND_API_KEY env fallback
  webhookSecret?: string;   // RESEND_WEBHOOK_SECRET env fallback
  fromAddress: string;      // Required: sender email
  fromName?: string;        // Display name for From header
}
```

## Error Handling

| Scenario | Error Type |
|---|---|
| Missing API key | `AuthenticationError` in `initialize()` |
| Invalid webhook signature | `AuthenticationError` → 401 |
| Malformed webhook payload | `ValidationError` → 400 |
| Resend API failure | `NetworkError` |
| Unsupported operation | `NotImplementedError` |

All error types from `@chat-adapter/shared`.

## Dependencies

| Package | Version | Purpose |
|---|---|---|
| `chat` | `4.15.0` | Chat SDK core (peer dep) |
| `@chat-adapter/shared` | `4.15.0` | Shared utilities (peer dep) |
| `resend` | `6.9.2` | Resend API client |
| `@react-email/components` | `1.0.8` | Email components |
| `@react-email/render` | `2.0.4` | JSX → HTML |
