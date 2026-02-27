import { describe, it, expect } from "vitest";
import { parseInboundEmail } from "../src/message-parser.js";
import type { ResendReceivedEmail } from "../src/types.js";

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
    const result = parseInboundEmail(baseEmail, "resend:bot@example.com:abc123");
    expect(result.id).toBe("re_123");
    expect(result.threadId).toBe("resend:bot@example.com:abc123");
    expect(result.text).toBe("Hello bot");
    expect(result.author.name).toBe("user@example.com");
    expect(result.isMention).toBe(true);
  });

  it("extracts author from email address with display name", () => {
    const email = { ...baseEmail, from: "John Doe <john@example.com>" };
    const result = parseInboundEmail(email, "thread1");
    expect(result.author.id).toBe("john@example.com");
    expect(result.author.name).toContain("John Doe");
  });

  it("includes subject in metadata", () => {
    const result = parseInboundEmail(baseEmail, "thread1");
    expect(result.metadata.subject).toBe("Test email");
  });

  it("parses attachments", () => {
    const email: ResendReceivedEmail = {
      ...baseEmail,
      attachments: [
        { filename: "doc.pdf", content_type: "application/pdf" },
      ],
    };
    const result = parseInboundEmail(email, "thread1");
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].filename).toBe("doc.pdf");
  });

  it("uses text body, falls back to stripped html", () => {
    const htmlOnly: ResendReceivedEmail = {
      ...baseEmail,
      text: undefined,
      html: "<p>HTML only</p>",
    };
    const result = parseInboundEmail(htmlOnly, "thread1");
    expect(result.text).toContain("HTML only");
  });
});
