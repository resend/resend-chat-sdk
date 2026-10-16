# @resend/chat-sdk-adapter

Vercel Chat SDK adapter for [Resend](https://resend.com) email. Bidirectional: receive emails via Resend webhooks, send emails via Resend API.

The adapter works with a Resend [Inbox](https://resend.com/docs/api-reference/inboxes/create-inbox) or with [Receiving](https://resend.com/docs/dashboard/receiving/introduction). Set `inboxId` or `inboxEmailAddress` to use an inbox. See [Inboxes](#inboxes).

## Install

```bash
pnpm add @resend/chat-sdk-adapter chat @chat-adapter/shared
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
type ResendAdapterConfig = {
  /** Sender email address (required). */
  fromAddress: string;
  /** Display name for the From header. */
  fromName?: string;
  /** Resend API key. Falls back to RESEND_API_KEY env var. */
  apiKey?: string;
  /** Webhook signing secret. Falls back to RESEND_WEBHOOK_SECRET env var. */
  webhookSecret?: string;
} & (
  /** Resend inbox ID. Handles `inbox.email.received` and replies in the inbox thread. */
  | { inboxId?: string; inboxEmailAddress?: never }
  /** Resend inbox email address. Works as `inboxId` does. */
  | { inboxId?: never; inboxEmailAddress?: string }
);
```

Set `inboxId` or `inboxEmailAddress`, not both. Setting both is a type error.

## Features

### Inboxes

Set `inboxId` or `inboxEmailAddress` to build the bot on a Resend Inbox. The inbox groups email into threads, and the bot replies inside the thread. Resend sets the recipients and the threading headers.

```ts
const resend = createResendAdapter({
  fromAddress: "agent@yourdomain.com", // the inbox address
  inboxId: "b3e2b2b6-3f0e-4c8e-9ad3-2f43a1e2c7f1",
});
```

You can also select the inbox by its email address:

```ts
const resend = createResendAdapter({
  fromAddress: "agent@yourdomain.com",
  inboxEmailAddress: "agent@yourdomain.com",
});
```

Set `inboxId` or `inboxEmailAddress`, not both. The adapter throws an error when you set both. The `inbox.email.received` payload identifies the inbox by its ID. With `inboxEmailAddress`, the adapter gets the inbox ID with `resend.inboxes.get()` on the first `inbox.email.received` event and keeps it. If the inbox does not exist, `handleWebhook()` throws an error. Thread IDs use the inbox ID in both cases.

Subscribe your webhook to `inbox.email.received`. With an inbox set, the adapter:

- Handles `inbox.email.received` events for that inbox only. It ignores other inboxes and `email.received` events.
- Fetches the email with `resend.inboxes.threads.emails.get()`. The webhook payload has no body.
- Maps each inbox thread to one Chat SDK thread, with the ID `resend:{inboxId}:{threadId}`. The channel is the inbox.
- Posts with `resend.inboxes.threads.emails.reply()`, to the last received email of the thread, or to its last email when it has no received email. The reply goes to the `Reply-To` addresses of a received email, or to its sender when it has none. For a sent email, it goes to that email's `to` recipients. The reply is sent from the inbox address, so `fromName` does not apply to it.

A sender can set `Reply-To` to any address. Check `message.raw.replyTo` before the bot replies with anything sensitive.

`openDM()` still sends with `resend.emails.send()` from `fromAddress`, as without an inbox.

### Email Threading

Without an inbox, threads are resolved using standard `Message-ID`, `In-Reply-To`, and `References` email headers. Reply chains are automatically grouped into Chat SDK threads.

### Send Emails Proactively

Use `openDM` to start a new email thread to any address:

```ts
const threadId = await resend.openDM("user@example.com");
await resend.postMessage(threadId, "Hello from the bot!");
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

Inbound email attachments are available in `message.raw.attachments` with `filename`, `content_type`, and `url` fields. For an inbox email, each attachment has `id`, `filename` and `size`.

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

## Documentation

Official docs available at [resend.com/docs/chat-sdk](https://resend.com/docs/chat-sdk).

## License

MIT
