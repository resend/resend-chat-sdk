import { parseEmailAddress, stripHtml } from "./utils.js";
import { ResendFormatConverter } from "./format-converter.js";
import type { ResendReceivedEmail, ResendRawMessage } from "./types.js";

interface ParsedMessage {
  id: string;
  threadId: string;
  text: string;
  formatted: ReturnType<ResendFormatConverter["toAst"]>;
  raw: ResendRawMessage;
  author: {
    id: string;
    name: string;
    isBot: boolean;
  };
  metadata: {
    subject: string;
    messageId: string;
    [key: string]: unknown;
  };
  attachments: Array<{
    filename: string;
    contentType: string;
    url?: string;
  }>;
  isMention: boolean;
}

const converter = new ResendFormatConverter();

export function parseInboundEmail(
  email: ResendReceivedEmail,
  threadId: string,
): ParsedMessage {
  const authorEmail = parseEmailAddress(email.from);
  const authorName = extractDisplayName(email.from);
  const text = email.text || stripHtml(email.html || "");
  const formatted = converter.toAst(text);

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

  return {
    id: email.id,
    threadId,
    text,
    formatted,
    raw,
    author: {
      id: authorEmail,
      name: authorName,
      isBot: false,
    },
    metadata: {
      subject: email.subject,
      messageId: email.message_id,
    },
    attachments: (email.attachments || []).map((a) => ({
      filename: a.filename,
      contentType: a.content_type,
    })),
    isMention: true,
  };
}

function extractDisplayName(from: string): string {
  const match = from.match(/^([^<]+)<[^>]+>$/);
  if (match) return match[1].trim();
  return from;
}
