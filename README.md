# @resend/chat-sdk-adapter

Vercel Chat SDK adapter for [Resend](https://resend.com) email. Bidirectional: receive emails via Resend webhooks, send emails via Resend API.

The adapter works with a Resend [Inbox](https://resend.com/docs/api-reference/inboxes/create-inbox) or with [Receiving](https://resend.com/docs/dashboard/receiving/introduction). Set `inboxId` or `inboxEmailAddress` to use an inbox. See [Inboxes](#inboxes).

## Install

```bash
pnpm add @resend/chat-sdk-adapter chat @chat-adapter/shared @chat-adapter/state-memory
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
| `RESEND_WEBHOOK_SECRET` | Webhook signing secret (overridden by `config.webhookSecret`, ignored with `config.webhookVerifier`) |
| `FROM_ADDRESS` | Used by example apps only |

### `ResendAdapterConfig`

```ts
type ResendAdapterConfig = {
  /** Sender email address (required). */
  fromAddress: string;
  /** Display name for the From header. */
  fromName?: string;
  /** Resend API key, or a function that returns one. Falls back to RESEND_API_KEY env var. */
  apiKey?: string | (() => string | Promise<string>);
  /** With an inbox, start a new inbox thread from `openDM()`. Defaults to `false`. */
  startInboxThreads?: boolean;
  /** Webhook signing secret. Falls back to RESEND_WEBHOOK_SECRET env var. */
  webhookSecret?: string;
  /** Custom webhook verifier, used in place of the signing secret. */
  webhookVerifier?: (request: Request, body: string) => unknown | Promise<unknown>;
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

- Handles `inbox.email.received` events for that inbox only, and, with `startInboxThreads`, `inbox.draft.sent` events for the threads that `openDM()` starts. It ignores other inboxes and `email.received` events.
- Fetches the email with `resend.inboxes.threads.emails.get()`. The webhook payload has no body.
- Maps each inbox thread to one Chat SDK thread, with the ID `resend:{inboxId}:{threadId}`. The channel is the inbox.
- Fetches the thread history with `fetchMessages()`, from `resend.inboxes.threads.emails.list()`, and one email with `fetchMessage()`. An outbound email, sent from the inbox, has `author.isMe` and `author.isBot` set. The inbox API lists the oldest emails first, so the default `backward` fetch without a cursor lists the whole thread to find the newest emails. Without an inbox, `fetchMessages()` returns no messages and `fetchMessage()` returns `null`, because the Receiving API keeps no thread history.
- Posts with `resend.inboxes.threads.emails.reply()`, to the last received email of the thread, or to its last email when it has no received email. The reply goes to the `Reply-To` addresses of a received email, or to its sender when it has none. For a sent email, it goes to that email's `to` recipients. The reply is sent from the inbox address, so `fromName` does not apply to it.

A sender can set `Reply-To` to any address. Check `message.raw.replyTo` before the bot replies with anything sensitive.

### Start Inbox Threads

By default, `openDM()` sends with `resend.emails.send()` from `fromAddress`, as without an inbox, so the email is not in the inbox. Set `startInboxThreads` to start a new inbox thread instead:

```ts
const resend = createResendAdapter({
  fromAddress: "agent@yourdomain.com",
  inboxId: "b3e2b2b6-3f0e-4c8e-9ad3-2f43a1e2c7f1",
  startInboxThreads: true,
});

const threadId = await resend.openDM("user@example.com");
await resend.postMessage(threadId, "Your order has shipped.");
```

The first post creates a standalone draft with `resend.inboxes.drafts.create()`, with the subject `New message`, and sends it with `resend.inboxes.drafts.send()`. Resend creates the thread when it sends the draft, and returns the thread ID only in the `inbox.draft.sent` event. So the thread ID from `openDM()` is a placeholder until that event arrives. After that, the adapter replies in the Resend thread, and processes replies from the recipient in the thread of `openDM()`.

With `startInboxThreads`:

- Subscribe your webhook to `inbox.draft.sent`, as well as `inbox.email.received`.
- Use a persistent state adapter, such as Redis. The adapter keeps the link between the placeholder and the Resend thread in the state adapter, and the first post, the `inbox.draft.sent` event and the replies can reach different server instances.
- With `inboxEmailAddress`, call `initialize()` first, so that the adapter can get the inbox ID.

A second post before the `inbox.draft.sent` event throws an error. Until the event arrives, `fetchMessages()` returns no messages.

### API Key Function

Set `apiKey` to a function to get the key when the adapter needs it. The adapter calls the function each time it calls the Resend API, so a rotated or short-lived key takes effect without a new adapter.

```ts
const resend = createResendAdapter({
  fromAddress: "bot@yourdomain.com",
  apiKey: () => getResendApiKey(),
});
```

### Custom Webhook Verification

By default, the adapter verifies the Svix signature of each webhook with `webhookSecret`. Set `webhookVerifier` when a trusted proxy verifies the Resend signature and forwards the webhook with its own credential. The adapter then calls the verifier in place of the signature check, and ignores `webhookSecret` and `RESEND_WEBHOOK_SECRET`.

```ts
const resend = createResendAdapter({
  fromAddress: "bot@yourdomain.com",
  webhookVerifier: (request, body) => verifyProxyToken(request),
});
```

The verifier receives the `Request` and the raw body text. Return a truthy value to accept the webhook. Return a falsy value or throw to reject it, and the adapter responds with `401`. The verifier replaces the Svix check, including its timestamp check, so it must reject replayed requests itself.

### Email Threading

Without an inbox, threads are resolved using standard `Message-ID`, `In-Reply-To`, and `References` email headers. Reply chains are automatically grouped into Chat SDK threads.

### Send Emails Proactively

Use `openDM` to start a new email thread to any address:

```ts
const threadId = await resend.openDM("user@example.com");
await resend.postMessage(threadId, "Hello from the bot!");
```

### Card Emails

Send HTML emails with Chat SDK card elements. The adapter renders them with [React Email](https://react.email). Put a `link-button` inside an `actions` element:

```ts
await thread.post({
  card: {
    type: "card",
    title: "Order Confirmed",
    children: [
      { type: "text", content: "Your order #1234 has been shipped." },
      { type: "divider" },
      {
        type: "actions",
        children: [
          { type: "link-button", label: "Track Order", url: "https://example.com/track/1234" },
        ],
      },
    ],
  },
  fallbackText: "Order #1234 confirmed",
});
```

### Attachments

Inbound email attachments are in `message.raw.attachments`, as `ResendAttachment` objects. The adapter does not download the attachment content.

- An attachment of an `email.received` email has `filename` and `contentType`.
- An attachment of an inbox email has `id`, `filename`, `size` and `contentType`. The inbox API does not return the MIME type, so `contentType` is always `application/octet-stream`.

```ts
import type { ResendRawMessage } from "@resend/chat-sdk-adapter";

chat.onNewMention(async (thread, message) => {
  const raw = message.raw as ResendRawMessage;
  for (const attachment of raw.attachments ?? []) {
    console.log(attachment.filename, attachment.contentType, attachment.size);
  }
});
```

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
