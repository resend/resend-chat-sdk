import { describe, it, expect, vi, beforeEach } from "vitest";
import { ResendAdapter } from "../src/adapter.js";
import type { ResendAdapterConfig } from "../src/types.js";

// Mock Resend SDK
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: {
      send: vi.fn().mockResolvedValue({
        data: { id: "re_sent_123" },
      }),
      receiving: {
        get: vi.fn(),
      },
    },
    webhooks: {
      verify: vi.fn(),
    },
  })),
}));

const config: ResendAdapterConfig = {
  apiKey: "re_test_123",
  webhookSecret: "whsec_test",
  fromAddress: "bot@example.com",
  fromName: "Test Bot",
};

describe("ResendAdapter", () => {
  let adapter: ResendAdapter;

  beforeEach(() => {
    adapter = new ResendAdapter(config);
  });

  describe("properties", () => {
    it("has correct name", () => {
      expect(adapter.name).toBe("resend");
    });

    it("has correct userName", () => {
      expect(adapter.userName).toBe("bot@example.com");
    });
  });

  describe("initialize", () => {
    it("stores chat instance reference", async () => {
      const mockChat = { processMessage: vi.fn() };
      await adapter.initialize(mockChat as any);
    });

    it("throws without API key", async () => {
      const noKeyAdapter = new ResendAdapter({
        ...config,
        apiKey: undefined,
      });
      const env = process.env.RESEND_API_KEY;
      delete process.env.RESEND_API_KEY;
      await expect(noKeyAdapter.initialize({} as any)).rejects.toThrow();
      if (env) process.env.RESEND_API_KEY = env;
    });
  });

  describe("encodeThreadId / decodeThreadId", () => {
    it("roundtrips thread ID", () => {
      const encoded = adapter.encodeThreadId({
        toAddress: "bot@example.com",
        rootMessageIdHash: "abcdef0123456789",
      });
      const decoded = adapter.decodeThreadId(encoded);
      expect(decoded.toAddress).toBe("bot@example.com");
      expect(decoded.rootMessageIdHash).toBe("abcdef0123456789");
    });
  });

  describe("postMessage", () => {
    it("sends email via Resend", async () => {
      const mockChat = { processMessage: vi.fn() };
      await adapter.initialize(mockChat as any);

      const result = await adapter.postMessage(
        "resend:user@example.com:abcdef0123456789",
        { text: "Hello from bot" },
      );
      expect(result.id).toBe("re_sent_123");
      expect(result.threadId).toBe("resend:user@example.com:abcdef0123456789");
    });
  });

  describe("unsupported operations", () => {
    it("editMessage throws", async () => {
      await expect(
        adapter.editMessage("thread", "msg", { text: "edited" }),
      ).rejects.toThrow(/not implemented|not supported/i);
    });

    it("deleteMessage throws", async () => {
      await expect(
        adapter.deleteMessage("thread", "msg"),
      ).rejects.toThrow(/not implemented|not supported/i);
    });

    it("addReaction throws", async () => {
      await expect(
        adapter.addReaction("thread", "msg", "thumbsup"),
      ).rejects.toThrow(/not implemented|not supported/i);
    });

    it("removeReaction throws", async () => {
      await expect(
        adapter.removeReaction("thread", "msg", "thumbsup"),
      ).rejects.toThrow(/not implemented|not supported/i);
    });

    it("startTyping throws", async () => {
      await expect(
        adapter.startTyping("thread"),
      ).rejects.toThrow(/not implemented|not supported/i);
    });
  });

  describe("renderFormatted", () => {
    it("converts formatted content to HTML", () => {
      const html = adapter.renderFormatted({
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", value: "test" }],
          },
        ],
      });
      expect(html).toContain("test");
    });
  });

  describe("openDM", () => {
    it("creates thread for email address", async () => {
      const threadId = await adapter.openDM("user@example.com");
      expect(threadId).toMatch(/^resend:user@example\.com:[0-9a-f]{16}$/);
    });
  });

  describe("fetchThread", () => {
    it("returns thread info", async () => {
      const info = await adapter.fetchThread("resend:user@example.com:abc123");
      expect(info.id).toBe("resend:user@example.com:abc123");
      expect(info.title).toContain("user@example.com");
    });
  });

  describe("fetchMessages", () => {
    it("returns empty result", async () => {
      const result = await adapter.fetchMessages("resend:user@example.com:abc123");
      expect(result.messages).toEqual([]);
      expect(result.hasMore).toBe(false);
    });
  });

  describe("parseMessage", () => {
    it("parses raw message", () => {
      const parsed = adapter.parseMessage({
        id: "re_123",
        messageId: "<msg@test.com>",
        from: "user@example.com",
        to: ["bot@example.com"],
        subject: "Test",
        text: "Hello",
        createdAt: "2025-01-01T00:00:00Z",
      });
      expect(parsed.id).toBe("re_123");
      expect(parsed.text).toBe("Hello");
      expect(parsed.author.id).toBe("user@example.com");
    });
  });
});
