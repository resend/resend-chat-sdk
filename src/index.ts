// @resend/chat-sdk-adapter

export type { ChatInstance } from "./adapter.js";
export { ResendAdapter } from "./adapter.js";
export type {
  ResendAdapterConfig,
  ResendAttachment,
  ResendPostExtensions,
  ResendRawMessage,
  ResendReceivedEmail,
  ResendThreadId,
  ResendWebhookPayload,
} from "./types.js";

import type { Adapter } from "chat";
import { ResendAdapter } from "./adapter.js";
import type {
  ResendAdapterConfig,
  ResendRawMessage,
  ResendThreadId,
} from "./types.js";

/**
 * Create a new Resend adapter instance.
 * Reads config + env vars (RESEND_API_KEY, RESEND_WEBHOOK_SECRET).
 */
export function createResendAdapter(
  config: ResendAdapterConfig
): ResendAdapter {
  const adapter = new ResendAdapter(config) satisfies Adapter<
    ResendThreadId,
    ResendRawMessage
  >;

  return adapter;
}
