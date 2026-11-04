---
"@resend/chat-sdk-adapter": minor
---

Fetch the emails of an inbox thread with `fetchMessages()`, and one email with `fetchMessage()`. An outbound inbox email has `author.isMe` and `author.isBot` set, and is not a mention. Add the `startInboxThreads` option, to start a new inbox thread from `openDM()` with a standalone draft. It needs a webhook subscription to `inbox.draft.sent` and a persistent state adapter. Without it, `openDM()` sends with `resend.emails.send()` as before.
