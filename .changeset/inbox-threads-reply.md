---
"@resend/chat-sdk-adapter": minor
---

Add Resend Inboxes support. Set `inboxId` to handle `inbox.email.received` for that inbox, fetch the email with `resend.inboxes.threads.emails.get()` and reply in the inbox thread with `resend.inboxes.threads.emails.reply()`. Each inbox thread maps to one Chat SDK thread, `resend:{inboxId}:{threadId}`. Without `inboxId`, the adapter works on Receiving as before. `resend` is now `^6.33.0`.

`decodeThreadId()` now returns `ResendThreadId | ResendInboxThreadId`. TypeScript code that reads `toAddress` from it must check `"toAddress" in id` first.
