// resend-chat-sdk

export type { ChatInstance } from "./adapter.js";
export { ResendAdapter } from "./adapter.js";
export type {
  ResendAdapterConfig,
  ResendAttachment,
  ResendRawMessage,
  ResendReceivedEmail,
  ResendThreadId,
  ResendWebhookPayload,
} from "./types.js";

import { ResendAdapter } from "./adapter.js";
import type { ResendAdapterConfig } from "./types.js";

/**
 * Create a new Resend adapter instance.
 * Reads config + env vars (RESEND_API_KEY, RESEND_WEBHOOK_SECRET).
 */
export function createResendAdapter(
  config: ResendAdapterConfig
): ResendAdapter {
  return new ResendAdapter(config);
}
