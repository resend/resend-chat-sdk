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

export type ResendApiKey = string | (() => Promise<string>);

export type ResendWebhookVerifier = (
  request: Request,
  rawBody: string
) => Promise<unknown> | unknown;

export interface ResendAdapterConfig {
  /** Resend API key or lazy resolver. Falls back to RESEND_API_KEY env var. */
  apiKey?: ResendApiKey;
  /** Sender email address (required). */
  fromAddress: string;
  /** Display name for the From header (optional). */
  fromName?: string;
  /** Resend webhook signing secret. Falls back to RESEND_WEBHOOK_SECRET env var. */
  webhookSecret?: string;
  /** Custom verifier for webhook gateways that authenticate forwarded requests. */
  webhookVerifier?: ResendWebhookVerifier;
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
