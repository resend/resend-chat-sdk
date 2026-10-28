import { Message, parseMarkdown } from "chat";
import type {
  ResendInboxEmail,
  ResendRawMessage,
  ResendReceivedEmail,
} from "./types.js";
import { parseEmailAddress, stripHtml } from "./utils.js";

const DISPLAY_NAME_RE = /^([^<]+)<[^>]+>$/;

export function parseInboundEmail(
  email: ResendReceivedEmail,
  threadId: string,
  fromAddress: string
): Message<ResendRawMessage> {
  const authorEmail = parseEmailAddress(email.from);
  const authorName = extractDisplayName(email.from);
  const text = email.text || stripHtml(email.html || "");

  const raw: ResendRawMessage = {
    id: email.id,
    messageId: email.message_id,
    from: email.from,
    to: email.to,
    cc: email.cc,
    subject: email.subject,
    text: email.text,
    html: email.html,
    headers: email.headers,
    createdAt: email.created_at,
    attachments: (email.attachments || []).map((a) => ({
      filename: a.filename,
      contentType: a.content_type,
    })),
  };

  return new Message<ResendRawMessage>({
    id: email.id,
    threadId,
    text,
    formatted: parseMarkdown(text),
    raw,
    author: {
      userId: authorEmail,
      userName: authorEmail,
      fullName: authorName,
      isBot: false,
      isMe: authorEmail === fromAddress,
    },
    metadata: {
      dateSent: new Date(email.created_at),
      edited: false,
    },
    attachments: (email.attachments || []).map((a) => ({
      type: "file" as const,
      name: a.filename,
      mimeType: a.content_type,
    })),
    isMention: true,
  });
}

const UNKNOWN_CONTENT_TYPE = "application/octet-stream";

export function parseInboxEmail(
  email: ResendInboxEmail,
  thread: { inboxId: string; threadId: string },
  chatThreadId: string,
  fromAddress: string
): Message<ResendRawMessage> {
  const authorEmail = parseEmailAddress(email.from);
  const authorName = extractDisplayName(email.from);
  const text = email.text || stripHtml(email.html || "");
  // An inbox sends an outbound email, from the inbox address.
  const isOutbound = email.direction === "outbound";

  const raw: ResendRawMessage = {
    id: email.id,
    inboxId: thread.inboxId,
    inboxThreadId: thread.threadId,
    messageId: email.message_id ?? "",
    from: email.from,
    to: email.to,
    cc: email.cc,
    replyTo: email.reply_to,
    subject: email.subject ?? "",
    text: email.text ?? undefined,
    html: email.html ?? undefined,
    createdAt: email.received_at,
    attachments: email.attachments.map((a) => ({
      id: a.id,
      filename: a.filename ?? "",
      contentType: UNKNOWN_CONTENT_TYPE,
      size: a.size ?? undefined,
    })),
  };

  return new Message<ResendRawMessage>({
    id: email.id,
    threadId: chatThreadId,
    text,
    formatted: parseMarkdown(text),
    raw,
    author: {
      userId: authorEmail,
      userName: authorEmail,
      fullName: authorName,
      isBot: isOutbound,
      isMe: isOutbound || authorEmail === fromAddress.toLowerCase(),
    },
    metadata: {
      dateSent: new Date(email.received_at),
      edited: false,
    },
    attachments: email.attachments.map((a) => ({
      type: "file" as const,
      name: a.filename ?? undefined,
      size: a.size ?? undefined,
    })),
    isMention: !isOutbound,
  });
}

function extractDisplayName(from: string): string {
  const match = from.match(DISPLAY_NAME_RE);
  if (match) {
    return match[1].trim();
  }
  return from;
}
