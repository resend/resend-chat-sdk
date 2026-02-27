import { Message, parseMarkdown } from "chat";
import type { ResendRawMessage, ResendReceivedEmail } from "./types.js";
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

function extractDisplayName(from: string): string {
  const match = from.match(DISPLAY_NAME_RE);
  if (match) {
    return match[1].trim();
  }
  return from;
}
