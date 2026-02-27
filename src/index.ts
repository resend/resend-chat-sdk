// @chat-adapter/resend

export type { ChatInstance } from "./adapter.js";
export { ResendAdapter } from "./adapter.js";
export type { CardNode } from "./card-renderer.js";
export { renderCard } from "./card-renderer.js";
export { ResendFormatConverter } from "./format-converter.js";
export { parseInboundEmail } from "./message-parser.js";

export { renderMessage } from "./message-renderer.js";
export { ThreadResolver } from "./thread-resolver.js";
export type {
  ResendAdapterConfig,
  ResendAttachment,
  ResendRawMessage,
  ResendReceivedEmail,
  ResendThreadId,
  ResendWebhookPayload,
} from "./types.js";
export {
  generateMessageId,
  hashMessageId,
  parseEmailAddress,
  stripHtml,
} from "./utils.js";
export { WebhookHandler } from "./webhook-handler.js";

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
