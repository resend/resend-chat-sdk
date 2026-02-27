import { describe, expect, it } from "vitest";
import { parseInboundEmail } from "../src/message-parser.js";
import type { ResendReceivedEmail } from "../src/types.js";

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
