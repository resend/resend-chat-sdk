// @chat-adapter/resend

export type {
  ResendThreadId,
  ResendRawMessage,
  ResendAttachment,
  ResendAdapterConfig,
  ResendWebhookPayload,
  ResendReceivedEmail,
} from "./types.js";

export { hashMessageId, parseEmailAddress, generateMessageId } from "./utils.js";

export { ThreadResolver } from "./thread-resolver.js";

export { ResendFormatConverter } from "./format-converter.js";

export { renderCard } from "./card-renderer.js";

export { renderMessage } from "./message-renderer.js";

export { parseInboundEmail } from "./message-parser.js";

export { WebhookHandler } from "./webhook-handler.js";

export { ResendAdapter } from "./adapter.js";

import { ResendAdapter } from "./adapter.js";
import type { ResendAdapterConfig } from "./types.js";

/**
 * Create a new Resend adapter instance.
 * Reads config + env vars (RESEND_API_KEY, RESEND_WEBHOOK_SECRET).
 */
export function createResendAdapter(config: ResendAdapterConfig): ResendAdapter {
  return new ResendAdapter(config);
}
