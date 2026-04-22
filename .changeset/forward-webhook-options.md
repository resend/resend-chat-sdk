---
"@resend/chat-sdk-adapter": patch
---

Forward `WebhookOptions` through `ResendAdapter.handleWebhook` to `chat.processMessage`. `processMessage` is fire-and-forget, so on serverless platforms (e.g. Vercel Functions) the function would return 200 before the detached task finished — inbound emails were acknowledged but never processed. Callers can now pass `waitUntil` to keep the runtime alive until processing completes:

```ts
import { after } from "next/server";

adapter.handleWebhook(request, { waitUntil: (p) => after(() => p) });
```
