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
