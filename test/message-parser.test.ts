import { describe, expect, it } from "vitest";
import { parseInboundEmail, parseInboxEmail } from "../src/message-parser.js";
import type { ResendInboxEmail, ResendReceivedEmail } from "../src/types.js";

const FROM_ADDRESS = "bot@example.com";

describe("parseInboundEmail", () => {
  const baseEmail: ResendReceivedEmail = {
    id: "re_123",
    from: "user@example.com",
    to: ["bot@example.com"],
    subject: "Test email",
    message_id: "<msg1@mail.resend.dev>",
    text: "Hello bot",
    html: "<p>Hello bot</p>",
    created_at: "2025-01-01T00:00:00Z",
  };

  it("parses basic email fields", () => {
    const result = parseInboundEmail(
      baseEmail,
      "resend:bot@example.com:abc123",
      FROM_ADDRESS
    );
    expect(result.id).toBe("re_123");
    expect(result.threadId).toBe("resend:bot@example.com:abc123");
    expect(result.text).toBe("Hello bot");
    expect(result.author.userName).toBe("user@example.com");
    expect(result.isMention).toBe(true);
  });

  it("extracts author from email address with display name", () => {
    const email = { ...baseEmail, from: "John Doe <john@example.com>" };
    const result = parseInboundEmail(email, "thread1", FROM_ADDRESS);
    expect(result.author.userId).toBe("john@example.com");
    expect(result.author.fullName).toContain("John Doe");
  });

  it("stores subject in raw message", () => {
    const result = parseInboundEmail(baseEmail, "thread1", FROM_ADDRESS);
    expect(result.raw.subject).toBe("Test email");
  });

  it("sets isMe true when sender matches fromAddress", () => {
    const selfEmail = { ...baseEmail, from: FROM_ADDRESS };
    const result = parseInboundEmail(selfEmail, "thread1", FROM_ADDRESS);
    expect(result.author.isMe).toBe(true);
  });

  it("sets isMe false when sender differs from fromAddress", () => {
    const result = parseInboundEmail(baseEmail, "thread1", FROM_ADDRESS);
    expect(result.author.isMe).toBe(false);
  });

  it("parses attachments", () => {
    const email: ResendReceivedEmail = {
      ...baseEmail,
      attachments: [{ filename: "doc.pdf", content_type: "application/pdf" }],
    };
    const result = parseInboundEmail(email, "thread1", FROM_ADDRESS);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].name).toBe("doc.pdf");
  });

  it("copies attachments to raw with camelCase contentType", () => {
    const email: ResendReceivedEmail = {
      ...baseEmail,
      attachments: [
        { filename: "photo.png", content_type: "image/png", id: "att-1" },
      ],
    };
    const result = parseInboundEmail(email, "thread1", FROM_ADDRESS);
    expect(result.raw.attachments).toHaveLength(1);
    expect(result.raw.attachments?.[0].filename).toBe("photo.png");
    expect(result.raw.attachments?.[0].contentType).toBe("image/png");
  });

  it("uses text body, falls back to stripped html", () => {
    const htmlOnly: ResendReceivedEmail = {
      ...baseEmail,
      text: undefined,
      html: "<p>HTML only</p>",
    };
    const result = parseInboundEmail(htmlOnly, "thread1", FROM_ADDRESS);
    expect(result.text).toContain("HTML only");
  });
});

describe("parseInboxEmail", () => {
  const thread = {
    inboxId: "b3e2b2b6-3f0e-4c8e-9ad3-2f43a1e2c7f1",
    threadId: "7c1f0a2e-5d3b-4e8a-9f61-2b8d4c6e1a90",
  };
  const chatThreadId = `resend:${thread.inboxId}:${thread.threadId}`;
  const email: ResendInboxEmail = {
    id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c",
    direction: "inbound",
    from: "Ada Lovelace <Ada@Example.org>",
    to: ["agent@example.com"],
    cc: [],
    bcc: [],
    reply_to: ["replies@example.org"],
    subject: "Refund for order 1041",
    message_id: "<1041@example.org>",
    html: "<p>Could I get a refund?</p>",
    text: null,
    attachments: [{ id: "att_1", filename: "receipt.pdf", size: 20_841 }],
    read: false,
    received_at: "2026-08-05T14:03:11.229Z",
  };

  it("maps the inbox email to a message", () => {
    const result = parseInboxEmail(email, thread, chatThreadId, FROM_ADDRESS);

    expect(result.id).toBe(email.id);
    expect(result.threadId).toBe(chatThreadId);
    expect(result.text).toBe("Could I get a refund?");
    expect(result.author.userId).toBe("ada@example.org");
    expect(result.author.fullName).toBe("Ada Lovelace");
    expect(result.metadata.dateSent).toEqual(new Date(email.received_at));
    expect(result.isMention).toBe(true);
    expect(result.attachments).toEqual([
      { type: "file", name: "receipt.pdf", size: 20_841 },
    ]);
  });

  it("keeps the inbox IDs and Reply-To in the raw message", () => {
    const { raw } = parseInboxEmail(email, thread, chatThreadId, FROM_ADDRESS);

    expect(raw).toMatchObject({
      id: email.id,
      inboxId: thread.inboxId,
      inboxThreadId: thread.threadId,
      messageId: "<1041@example.org>",
      replyTo: ["replies@example.org"],
      subject: "Refund for order 1041",
      text: undefined,
      html: "<p>Could I get a refund?</p>",
      createdAt: email.received_at,
    });
    expect(raw.attachments).toEqual([
      {
        id: "att_1",
        filename: "receipt.pdf",
        contentType: "application/octet-stream",
        size: 20_841,
      },
    ]);
  });

  it("uses empty strings for a null subject and Message-ID", () => {
    const { raw } = parseInboxEmail(
      { ...email, subject: null, message_id: null },
      thread,
      chatThreadId,
      FROM_ADDRESS
    );

    expect(raw.subject).toBe("");
    expect(raw.messageId).toBe("");
  });
});
