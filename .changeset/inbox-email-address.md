---
"@resend/chat-sdk-adapter": minor
---

Add the `inboxEmailAddress` option. It selects the inbox by its email address, in place of `inboxId`. Set one of them, not both. On the first `inbox.email.received` event, the adapter gets the inbox ID with `resend.inboxes.get()` and keeps it. It filters events and builds thread IDs with that ID, as with `inboxId`. If the inbox does not exist, `handleWebhook()` throws an error. `ResendAdapterConfig` is now a type alias, not an interface. `resend` is now `^6.34.1`.
