import { describe, expect, it } from "vitest";
import {
  generateMessageId,
  hashMessageId,
  parseEmailAddress,
  stripHtml,
} from "../src/utils.js";

const HEX_16_PATTERN = /^[0-9a-f]{16}$/;
const MESSAGE_ID_PATTERN = /^<.+@example\.com>$/;

describe("hashMessageId", () => {
  it("returns 16-char hex string", async () => {
    const hash = await hashMessageId("<abc123@mail.resend.dev>");
    expect(hash).toMatch(HEX_16_PATTERN);
  });

  it("returns same hash for same input", async () => {
    const a = await hashMessageId("<test@example.com>");
    const b = await hashMessageId("<test@example.com>");
    expect(a).toBe(b);
  });

  it("returns different hashes for different inputs", async () => {
    const a = await hashMessageId("<a@example.com>");
    const b = await hashMessageId("<b@example.com>");
    expect(a).not.toBe(b);
  });
});

describe("parseEmailAddress", () => {
  it("extracts email from angle bracket format", () => {
    expect(parseEmailAddress("John Doe <john@example.com>")).toBe(
      "john@example.com"
    );
  });

  it("returns plain email as-is", () => {
    expect(parseEmailAddress("john@example.com")).toBe("john@example.com");
  });

  it("lowercases email", () => {
    expect(parseEmailAddress("John@Example.COM")).toBe("john@example.com");
  });

  it("trims whitespace", () => {
    expect(parseEmailAddress("  john@example.com  ")).toBe("john@example.com");
  });
});

describe("generateMessageId", () => {
  it("produces valid Message-ID format", () => {
    const id = generateMessageId("bot@example.com");
    expect(id).toMatch(MESSAGE_ID_PATTERN);
  });

  it("generates unique IDs", () => {
    const a = generateMessageId("bot@example.com");
    const b = generateMessageId("bot@example.com");
    expect(a).not.toBe(b);
  });
});

describe("stripHtml", () => {
  it("removes HTML tags", () => {
    expect(stripHtml("<p>Hello</p>")).toBe("Hello");
  });

  it("handles nested tags", () => {
    expect(stripHtml("<div><strong>Bold</strong> text</div>")).toBe(
      "Bold text"
    );
  });

  it("trims whitespace", () => {
    expect(stripHtml("  <p>Hello</p>  ")).toBe("Hello");
  });

  it("returns empty string for empty input", () => {
    expect(stripHtml("")).toBe("");
  });
});
