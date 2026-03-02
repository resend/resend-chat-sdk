# @resend/chat-sdk-adapter

Vercel Chat SDK adapter for [Resend](https://resend.com) email. Bidirectional: receive emails via Resend webhooks, send emails via Resend API.

## Install

```bash
npm install @resend/chat-sdk-adapter chat @chat-adapter/shared
```

## Quick Start

```ts
import { createResendAdapter } from "@resend/chat-sdk-adapter";
import { MemoryStateAdapter } from "@chat-adapter/state-memory";
import { Chat } from "chat";

const resend = createResendAdapter({
  fromAddress: "bot@yourdomain.com",
  fromName: "My Bot",         // optional
  // apiKey: "re_...",        // or set RESEND_API_KEY env var
  // webhookSecret: "whsec_..." // or set RESEND_WEBHOOK_SECRET env var
});

const chat = new Chat({
  userName: "email-bot",
  adapters: { resend },
  state: new MemoryStateAdapter(),
});

// New inbound email (new thread)
chat.onNewMention(async (thread, message) => {
  await thread.subscribe();
  await thread.post(`Got your email: ${message.text}`);
});

// Follow-up email in a subscribed thread
chat.onSubscribedMessage(async (thread, message) => {
  await thread.post(`Reply: ${message.text}`);
});
```

Forward Resend webhooks to your server's `/webhook` endpoint. See [examples/basic](./examples/basic) for a full working server.

## Configuration

### Environment Variables

| Variable | Description |
|---|---|
| `RESEND_API_KEY` | Resend API key (overridden by `config.apiKey`) |
| `RESEND_WEBHOOK_SECRET` | Webhook signing secret (overridden by `config.webhookSecret`) |
| `FROM_ADDRESS` | Used by example apps only |

### `ResendAdapterConfig`

```ts
interface ResendAdapterConfig {
  /** Sender email address (required). */
  fromAddress: string;
  /** Display name for the From header. */
  fromName?: string;
  /** Resend API key. Falls back to RESEND_API_KEY env var. */
  apiKey?: string;
  /** Webhook signing secret. Falls back to RESEND_WEBHOOK_SECRET env var. */
  webhookSecret?: string;
}
```

## Features

### Email Threading

Threads are resolved using standard `Message-ID`, `In-Reply-To`, and `References` email headers. Reply chains are automatically grouped into Chat SDK threads.

### Send Emails Proactively

Use `openDM` to start a new email thread to any address:

```ts
const threadId = await chat.adapters.resend.openDM("user@example.com");
const thread = await chat.thread("resend", threadId);
await thread.post("Hello from the bot!");
```

### Card Emails

Send rich HTML emails using Chat SDK Card elements, rendered via `@react-email/components`:

```ts
await thread.post({
  card: {
    type: "card",
    title: "Order Confirmed",
    children: [
      { type: "text", content: "Your order #1234 has been shipped." },
      { type: "divider" },
      { type: "link-button", label: "Track Order", url: "https://example.com/track/1234" },
    ],
  },
  fallbackText: "Order #1234 confirmed",
});
```

### Attachments

Inbound email attachments are available in `message.raw.attachments` with `filename`, `content_type`, and `url` fields.

## Unsupported Operations

Email is inherently one-shot. The following operations throw `NotImplementedError`:

- `editMessage` / `deleteMessage`
- `addReaction` / `removeReaction`
- `startTyping`

## Examples

| Example | Description |
|---|---|
| [basic](./examples/basic) | Echo bot - replies to every email |
| [welcome-cards](./examples/welcome-cards) | Sends a styled card email on first contact |
| [notifications](./examples/notifications) | Proactive emails via `openDM()` + HTTP POST |
| [support-bot](./examples/support-bot) | Multi-turn support with subscribe/unsubscribe |
| [attachments](./examples/attachments) | Detects attachments and replies with a summary |

## License

MIT
