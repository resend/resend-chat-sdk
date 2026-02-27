import type { ResendWebhookPayload, ResendReceivedEmail } from "../../src/types.js";

export const validWebhookPayload: ResendWebhookPayload = {
  type: "email.received",
  created_at: "2025-01-15T10:30:00Z",
  data: {
    email_id: "re_webhook_123",
    from: "sender@example.com",
    to: ["bot@example.com"],
    subject: "Test webhook email",
    message_id: "<webhook-msg-1@mail.resend.dev>",
  },
};

export const replyWebhookPayload: ResendWebhookPayload = {
  type: "email.received",
  created_at: "2025-01-15T10:35:00Z",
  data: {
    email_id: "re_webhook_456",
    from: "sender@example.com",
    to: ["bot@example.com"],
    subject: "Re: Test webhook email",
    message_id: "<webhook-msg-2@mail.resend.dev>",
  },
};

export const receivedEmail: ResendReceivedEmail = {
  id: "re_webhook_123",
  from: "sender@example.com",
  to: ["bot@example.com"],
  subject: "Test webhook email",
  message_id: "<webhook-msg-1@mail.resend.dev>",
  text: "Hello from the webhook test!",
  html: "<p>Hello from the webhook test!</p>",
  headers: {},
  created_at: "2025-01-15T10:30:00Z",
};

export const receivedReplyEmail: ResendReceivedEmail = {
  id: "re_webhook_456",
  from: "sender@example.com",
  to: ["bot@example.com"],
  subject: "Re: Test webhook email",
  message_id: "<webhook-msg-2@mail.resend.dev>",
  text: "This is a reply!",
  html: "<p>This is a reply!</p>",
  headers: {
    "In-Reply-To": "<webhook-msg-1@mail.resend.dev>",
    References: "<webhook-msg-1@mail.resend.dev>",
  },
  created_at: "2025-01-15T10:35:00Z",
};

export const emailWithAttachments: ResendReceivedEmail = {
  ...receivedEmail,
  id: "re_with_attach",
  attachments: [
    { filename: "document.pdf", content_type: "application/pdf" },
    { filename: "image.png", content_type: "image/png" },
  ],
};
