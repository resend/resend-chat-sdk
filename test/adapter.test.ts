import { describe, it, expect, vi, beforeEach } from "vitest";
import { ResendAdapter } from "../src/adapter.js";
import type { ResendAdapterConfig } from "../src/types.js";

// Mock Resend SDK
const mockSend = vi.fn().mockResolvedValue({
  data: { id: "re_sent_123" },
});
const mockReceivingGet = vi.fn();
const mockVerify = vi.fn();

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: {
      send: mockSend,
      receiving: {
        get: mockReceivingGet,
      },
    },
    webhooks: {
      verify: mockVerify,
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
    vi.clearAllMocks();
    mockSend.mockResolvedValue({ data: { id: "re_sent_123" } });
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
      await adapter.initialize(mockChat);
    });

    it("throws without API key", async () => {
      const noKeyAdapter = new ResendAdapter({
        ...config,
        apiKey: undefined,
      });
      const env = process.env.RESEND_API_KEY;
      delete process.env.RESEND_API_KEY;
      await expect(noKeyAdapter.initialize({ processMessage: vi.fn() })).rejects.toThrow();
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
      await adapter.initialize(mockChat);

      const result = await adapter.postMessage(
        "resend:user@example.com:abcdef0123456789",
        { text: "Hello from bot" },
      );
      expect(result.id).toBe("re_sent_123");
      expect(result.threadId).toBe("resend:user@example.com:abcdef0123456789");
    });

    it("uses 'New message' subject when no subject stored", async () => {
      const mockChat = { processMessage: vi.fn() };
      await adapter.initialize(mockChat);

      await adapter.postMessage(
        "resend:user@example.com:abcdef0123456789",
        { text: "Hello" },
      );
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ subject: "New message" }),
      );
    });

    it("uses stored subject with Re: prefix", async () => {
      const mockChat = { processMessage: vi.fn() };
      await adapter.initialize(mockChat);

      // Simulate tracking a subject from an inbound email
      (adapter as any).threadResolver.trackSubject(
        "resend:user@example.com:abcdef0123456789",
        "Original Subject",
      );

      await adapter.postMessage(
        "resend:user@example.com:abcdef0123456789",
        { text: "Hello" },
      );
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ subject: "Re: Original Subject" }),
      );
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
      expect(info.channelId).toBe("resend:user@example.com");
      expect(info.metadata.toAddress).toBe("user@example.com");
    });
  });

  describe("fetchMessages", () => {
    it("returns empty result", async () => {
      const result = await adapter.fetchMessages("resend:user@example.com:abc123");
      expect(result.messages).toEqual([]);
      expect(result.nextCursor).toBeUndefined();
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
      expect(parsed.author.userId).toBe("user@example.com");
    });
  });

  describe("handleWebhook", () => {
    it("throws when webhook secret is missing", async () => {
      const noSecretAdapter = new ResendAdapter({
        ...config,
        webhookSecret: undefined,
      });
      const env = process.env.RESEND_WEBHOOK_SECRET;
      delete process.env.RESEND_WEBHOOK_SECRET;

      const mockChat = { processMessage: vi.fn() };
      await noSecretAdapter.initialize(mockChat);

      const request = new Request("https://example.com/webhook", {
        method: "POST",
        headers: {
          "svix-id": "msg_123",
          "svix-timestamp": "12345",
          "svix-signature": "v1,valid",
        },
        body: JSON.stringify({ type: "email.received", data: {} }),
      });

      await expect(noSecretAdapter.handleWebhook(request)).rejects.toThrow(
        "Webhook secret is required",
      );

      if (env) process.env.RESEND_WEBHOOK_SECRET = env;
    });

    it("processes webhook and calls chat.processMessage with correct args", async () => {
      const mockChat = { processMessage: vi.fn() };
      await adapter.initialize(mockChat);

      const webhookPayload = {
        type: "email.received",
        created_at: "2025-01-15T10:30:00Z",
        data: {
          email_id: "re_webhook_123",
          from: "sender@example.com",
          to: ["bot@example.com"],
          subject: "Test webhook email",
          message_id: "<webhook-msg-1@mail.resend.dev>",
        },
      };

      const fullEmail = {
        id: "re_webhook_123",
        from: "sender@example.com",
        to: ["bot@example.com"],
        subject: "Test webhook email",
        message_id: "<webhook-msg-1@mail.resend.dev>",
        text: "Hello from webhook!",
        html: "<p>Hello from webhook!</p>",
        headers: {},
        created_at: "2025-01-15T10:30:00Z",
      };

      mockVerify.mockReturnValue(webhookPayload);
      mockReceivingGet.mockResolvedValue({ data: fullEmail });

      const request = new Request("https://example.com/webhook", {
        method: "POST",
        headers: {
          "svix-id": "msg_123",
          "svix-timestamp": "12345",
          "svix-signature": "v1,valid",
        },
        body: JSON.stringify(webhookPayload),
      });

      const result = await adapter.handleWebhook(request);
      expect(result.status).toBe(200);

      expect(mockChat.processMessage).toHaveBeenCalledOnce();
      const [adapterArg, threadIdArg, messageArg] =
        mockChat.processMessage.mock.calls[0];

      expect(adapterArg).toBe(adapter);
      expect(threadIdArg).toMatch(/^resend:bot@example\.com:[0-9a-f]{16}$/);
      expect(messageArg.id).toBe("re_webhook_123");
      expect(messageArg.text).toBe("Hello from webhook!");
      expect(messageArg.author.id).toBe("sender@example.com");
      expect(messageArg.metadata.subject).toBe("Test webhook email");
    });
  });
});
