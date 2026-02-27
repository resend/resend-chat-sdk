/**
 * Decoded thread identifier for Resend email threads.
 * Encoded format: `resend:{toAddress}:{rootMessageIdHash}`
 */
export interface ResendThreadId {
  /** First recipient email address — acts as "channel" identifier */
  toAddress: string;
  /** SHA-256 hash (first 16 hex chars) of the root Message-ID */
  rootMessageIdHash: string;
}

export interface ResendRawMessage {
  /** Resend email ID (e.g., "re_abc123") */
  id: string;
  /** RFC 822 Message-ID header (e.g., "<abc@mail.resend.dev>") */
  messageId: string;
  /** Sender email address */
  from: string;
  /** Recipient email addresses */
  to: string[];
  /** CC recipients */
  cc?: string[];
  /** Email subject line */
  subject: string;
  /** Plain text body */
  text?: string;
  /** HTML body */
  html?: string;
  /** Email headers (In-Reply-To, References, etc.) */
  headers?: Record<string, string>;
  /** File attachments */
  attachments?: ResendAttachment[];
  /** ISO 8601 timestamp */
  createdAt: string;
}

export interface ResendAttachment {
  filename: string;
  contentType: string;
  /** Download URL (inbound emails) */
  url?: string;
  /** Base64-encoded content (outbound emails) */
  content?: string;
}

export interface ResendAdapterConfig {
  /** Resend API key. Falls back to RESEND_API_KEY env var. */
  apiKey?: string;
  /** Resend webhook signing secret. Falls back to RESEND_WEBHOOK_SECRET env var. */
  webhookSecret?: string;
  /** Sender email address (required). */
  fromAddress: string;
  /** Display name for the From header (optional). */
  fromName?: string;
}

export interface ResendWebhookPayload {
  type: "email.received";
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
      filename: string;
      content_type: string;
    }>;
  };
}

export interface ResendReceivedEmail {
  id: string;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  message_id: string;
  html?: string;
  text?: string;
  headers?: Record<string, string>;
  created_at: string;
  attachments?: Array<{
    filename: string;
    content_type: string;
  }>;
}
