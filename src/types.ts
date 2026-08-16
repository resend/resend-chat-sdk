/**
 * Decoded thread identifier for Resend email threads.
 * Encoded format: `resend:{toAddress}:{rootMessageIdHash}`
 */
export interface ResendThreadId {
  /** SHA-256 hash (first 16 hex chars) of the root Message-ID */
  rootMessageIdHash: string;
  /** First recipient email address — acts as "channel" identifier */
  toAddress: string;
}

export interface ResendRawMessage {
  /** File attachments */
  attachments?: ResendAttachment[];
  /** BCC recipients — set on outbound when `defaultBcc` / per-message `bcc` was applied. */
  bcc?: string[];
  /** CC recipients */
  cc?: string[];
  /** ISO 8601 timestamp */
  createdAt: string;
  /** Sender email address */
  from: string;
  /** Email headers (In-Reply-To, References, etc.) */
  headers?: Record<string, string>;
  /** HTML body */
  html?: string;
  /** Resend email ID (e.g., "re_abc123") */
  id: string;
  /** RFC 822 Message-ID header (e.g., "<abc@mail.resend.dev>") */
  messageId: string;
  /** Email subject line */
  subject: string;
  /** Plain text body */
  text?: string;
  /** Recipient email addresses */
  to: string[];
}

export interface ResendAttachment {
  /** Base64-encoded content (outbound emails) */
  content?: string;
  contentType: string;
  filename: string;
  /** Download URL (inbound emails) */
  url?: string;
}

export interface ResendAdapterConfig {
  /** Resend API key. Falls back to RESEND_API_KEY env var. */
  apiKey?: string;
  /** Sender email address (required). */
  fromAddress: string;
  /** Display name for the From header (optional). */
  fromName?: string;
  /** Resend webhook signing secret. Falls back to RESEND_WEBHOOK_SECRET env var. */
  webhookSecret?: string;
  /**
   * BCC every outbound message by default. Useful for observability or
   * compliance archives — e.g. copying every bot reply to an ops inbox.
   * A per-message `bcc` on `thread.post()` OVERRIDES this default (does
   * not merge) — including an explicit empty array, which suppresses the
   * default for a single call. Omit / empty array → no `bcc` field is
   * passed to Resend.
   */
  defaultBcc?: string[];
  /**
   * CC every outbound message by default. Per-message `cc` overrides with
   * the same semantics as `defaultBcc`.
   */
  defaultCc?: string[];
}

/**
 * Optional per-message extensions the Resend adapter honors on any
 * `AdapterPostableMessage` object shape (markdown / raw / ast / card /
 * normalized). Both fields override the corresponding `defaultBcc` /
 * `defaultCc` on the adapter config for THIS call only (they do not
 * merge — an explicit empty array is a valid "suppress the default"
 * signal). Attach either or both alongside the body:
 *
 *   await thread.post({
 *     markdown: "hi",
 *     bcc: ["observer@example.com"],
 *     cc:  ["audit@example.com"],
 *   });
 *
 * The Chat SDK's `AdapterPostableMessage` type is defined in `chat`
 * (upstream package) and doesn't declare these fields; they're accepted
 * here because Resend passes them straight through to
 * `resend.emails.send({ bcc, cc, … })`.
 */
export interface ResendPostExtensions {
  bcc?: string[];
  cc?: string[];
}

export interface ResendWebhookPayload {
  created_at: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    message_id: string;
    attachments?: Array<{
      content_disposition?: string;
      content_id?: string;
      content_type: string;
      filename: string;
      id?: string;
    }>;
  };
  type: "email.received";
}

export interface ResendReceivedEmail {
  attachments?: Array<{
    content_disposition?: string;
    content_id?: string;
    content_type: string;
    filename: string;
    id?: string;
  }>;
  cc?: string[];
  created_at: string;
  from: string;
  headers?: Record<string, string>;
  html?: string;
  id: string;
  message_id: string;
  subject: string;
  text?: string;
  to: string[];
}
