// @resend/chat-sdk-adapter

export type { ChatInstance } from "./adapter.js";
export { ResendAdapter } from "./adapter.js";
export type {
  ResendAdapterConfig,
  ResendApiKey,
  ResendAttachment,
  ResendInboxConfig,
  ResendInboxDraftSentPayload,
  ResendInboxEmail,
  ResendInboxThreadId,
  ResendInboxWebhookPayload,
  ResendRawMessage,
  ResendReceivedEmail,
  ResendThreadId,
  ResendWebhookPayload,
  ResendWebhookVerifier,
} from "./types.js";

import { ResendAdapter } from "./adapter.js";
import type { ResendAdapterConfig } from "./types.js";

/**
 * Create a new Resend adapter instance.
 * Reads config + env vars (RESEND_API_KEY, RESEND_WEBHOOK_SECRET).
 * `webhookVerifier` replaces the webhook secret when set.
 */
export function createResendAdapter(
  config: ResendAdapterConfig
): ResendAdapter {
  const adapter = new ResendAdapter(config);

  return adapter;
}
