import { type StateAdapter, ThreadImpl } from "chat";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResendAdapter } from "../src/adapter.js";
import { createResendAdapter } from "../src/index.js";
import type { ResendAdapterConfig } from "../src/types.js";

const NOT_SUPPORTED_PATTERN = /not implemented|not supported/i;
const OPEN_DM_THREAD_PATTERN = /^resend:user@example\.com:[0-9a-f]{16}$/;
const WEBHOOK_THREAD_PATTERN = /^resend:sender@example\.com:[0-9a-f]{16}$/;

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

function createStateAdapter(): StateAdapter {
  return {
    acquireLock: async () => null,
    appendToList: async () => undefined,
    connect: async () => undefined,
    delete: async () => undefined,
    disconnect: async () => undefined,
    extendLock: async () => true,
    forceReleaseLock: async () => undefined,
    get: async () => null,
    getList: async () => [],
    isSubscribed: async () => false,
    releaseLock: async () => undefined,
    set: async () => undefined,
    setIfNotExists: async () => true,
    subscribe: async () => undefined,
    unsubscribe: async () => undefined,
  };
}

function createStreamingThread(adapter: ResendAdapter): ThreadImpl {
  return new ThreadImpl({
    id: "resend:user@example.com:abcdef0123456789",
    channelId: "user@example.com",
    adapter,
    stateAdapter: createStateAdapter(),
    isDM: true,
    streamingUpdateIntervalMs: 10,
  });
}

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
      process.env.RESEND_API_KEY = "";
      await expect(
        noKeyAdapter.initialize({ processMessage: vi.fn() })
      ).rejects.toThrow();
      if (env) {
        process.env.RESEND_API_KEY = env;
      }
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

    it("derives a stable channel ID from a thread ID", async () => {
      const threadId = "resend:user@example.com:abcdef0123456789";

      expect(adapter.channelIdFromThreadId(threadId)).toBe(
        "resend:user@example.com"
      );
      await expect(adapter.fetchThread(threadId)).resolves.toMatchObject({
        channelId: adapter.channelIdFromThreadId(threadId),
      });
    });
  });

  describe("adapter compatibility", () => {
    it("creates an adapter instance accepted by Chat", () => {
      const resend = createResendAdapter({ fromAddress: "bot@example.com" });

      expect(resend).toBeInstanceOf(ResendAdapter);
      // Type-level coverage lives in createResendAdapter() via `satisfies Adapter`.
      expect(
        resend.channelIdFromThreadId("resend:user@example.com:abc123")
      ).toBe("resend:user@example.com");
    });
  });

  describe("postMessage", () => {
    it("sends email via Resend", async () => {
      const mockChat = { processMessage: vi.fn() };
      await adapter.initialize(mockChat);

      const result = await adapter.postMessage(
        "resend:user@example.com:abcdef0123456789",
        { text: "Hello from bot" }
      );
      expect(result.id).toBe("re_sent_123");
      expect(result.threadId).toBe("resend:user@example.com:abcdef0123456789");
    });

    it("uses 'New message' subject when no subject stored", async () => {
      const mockChat = { processMessage: vi.fn() };
      await adapter.initialize(mockChat);

      await adapter.postMessage("resend:user@example.com:abcdef0123456789", {
        text: "Hello",
      });
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ subject: "New message" })
      );
    });

    it("uses stored subject with Re: prefix", async () => {
      const mockChat = { processMessage: vi.fn() };
      await adapter.initialize(mockChat);

      // Simulate tracking a subject from an inbound email
      (adapter as any).threadResolver.trackSubject(
        "resend:user@example.com:abcdef0123456789",
        "Original Subject"
      );

      await adapter.postMessage("resend:user@example.com:abcdef0123456789", {
        text: "Hello",
      });
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ subject: "Re: Original Subject" })
      );
    });

    it("sends email with markdown message", async () => {
      const mockChat = { processMessage: vi.fn() };
      await adapter.initialize(mockChat);

      await adapter.postMessage("resend:user@example.com:abcdef0123456789", {
        markdown: "**bold**",
      });
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining("<strong>bold</strong>"),
          text: "bold",
        })
      );
    });

    it("passes plain string content through without markdown conversion", async () => {
      const mockChat = { processMessage: vi.fn() };
      await adapter.initialize(mockChat);

      await adapter.postMessage(
        "resend:user@example.com:abcdef0123456789",
        "**literal**"
      );

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "**literal**",
          html: "<p>**literal**</p>",
        })
      );
    });

    it("sends email with raw message", async () => {
      const mockChat = { processMessage: vi.fn() };
      await adapter.initialize(mockChat);

      await adapter.postMessage("resend:user@example.com:abcdef0123456789", {
        raw: "raw text",
      });
      expect(mockSend).toHaveBeenCalledOnce();
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: ["user@example.com"],
        })
      );
    });

    it("sends email with ast message", async () => {
      const mockChat = { processMessage: vi.fn() };
      await adapter.initialize(mockChat);

      const astRoot = {
        type: "root" as const,
        children: [
          {
            type: "paragraph" as const,
            children: [{ type: "text" as const, value: "ast content" }],
          },
        ],
      };

      await adapter.postMessage("resend:user@example.com:abcdef0123456789", {
        ast: astRoot,
      });
      expect(mockSend).toHaveBeenCalledOnce();
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: ["user@example.com"],
        })
      );
    });

    it("sends email with card message", async () => {
      const mockChat = { processMessage: vi.fn() };
      await adapter.initialize(mockChat);

      await adapter.postMessage("resend:user@example.com:abcdef0123456789", {
        card: {
          type: "Card",
          children: [
            {
              type: "CardHeader",
              children: [{ type: "text", value: "Hi" }],
            },
          ],
        },
      });
      expect(mockSend).toHaveBeenCalledOnce();
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: ["user@example.com"],
        })
      );
    });

    it("throws when Resend API returns an error", async () => {
      const mockChat = { processMessage: vi.fn() };
      await adapter.initialize(mockChat);

      mockSend.mockResolvedValueOnce({
        data: null,
        error: { message: "Rate limited" },
      });

      await expect(
        adapter.postMessage("resend:user@example.com:abcdef0123456789", {
          text: "Hello",
        })
      ).rejects.toThrow("Rate limited");
    });

    it("buffers streamed content and sends a single final email", async () => {
      const threadId = "resend:user@example.com:abcdef0123456789";

      let releaseSecondChunk!: () => void;
      const secondChunkGate = new Promise<void>((resolve) => {
        releaseSecondChunk = resolve;
      });

      const stream = (async function* () {
        yield "First part";
        await secondChunkGate;
        yield " second part";
      })();

      const postPromise = adapter.stream(threadId, stream);

      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(mockSend).not.toHaveBeenCalled();

      releaseSecondChunk();

      const sent = await postPromise;

      expect(sent.raw.text).toBe("First part second part");
      expect(mockSend).toHaveBeenCalledOnce();
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "First part second part",
        })
      );
    });

    it("preserves fullStream step separators before sending the email", async () => {
      const thread = createStreamingThread(adapter);

      const fullStreamLike = (async function* () {
        await Promise.resolve();
        yield { type: "text-delta", textDelta: "First step." };
        yield { type: "step-finish" };
        yield { type: "text-delta", textDelta: "Second step." };
      })();

      await thread.post(fullStreamLike as AsyncIterable<any>);

      expect(mockSend).toHaveBeenCalledOnce();
      const payload = mockSend.mock.calls[0]?.[0];
      expect(payload?.text).toContain("First step.");
      expect(payload?.text).toContain("Second step.");
      expect(payload?.html).toContain("<p>First step.</p>");
      expect(payload?.html).toContain("<p>Second step.</p>");
    });

    it("uses markdown_text chunks and ignores non-text structured chunks", async () => {
      const threadId = "resend:user@example.com:abcdef0123456789";

      const structuredStream = (async function* () {
        await Promise.resolve();
        yield { type: "markdown_text", text: "Searching..." };
        yield {
          type: "task_update",
          id: "search-1",
          title: "Searching documents",
          status: "in_progress",
        };
        yield { type: "markdown_text", text: " done." };
      })();

      const sent = await adapter.stream(
        threadId,
        structuredStream as AsyncIterable<any>
      );

      expect(sent.raw.text).toBe("Searching... done.");
      expect(mockSend).toHaveBeenCalledOnce();
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "Searching... done.",
        })
      );
    });

    it("derives a plain-text body from streamed markdown content", async () => {
      const threadId = "resend:user@example.com:abcdef0123456789";

      const markdownStream = (async function* () {
        await Promise.resolve();
        yield "**bold**";
      })();

      await adapter.stream(threadId, markdownStream);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining("<strong>bold</strong>"),
          text: "bold",
        })
      );
    });

    it("throws when a stream contains only unsupported structured chunks", async () => {
      const threadId = "resend:user@example.com:abcdef0123456789";

      const structuredOnlyStream = (async function* () {
        await Promise.resolve();
        yield {
          type: "task_update",
          id: "search-1",
          title: "Searching documents",
          status: "in_progress",
        };
        yield {
          type: "plan_update",
          title: "Search complete",
        };
      })();

      await expect(
        adapter.stream(threadId, structuredOnlyStream as AsyncIterable<any>)
      ).rejects.toThrow("no textual content");
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe("unsupported operations", () => {
    it("editMessage throws", () => {
      expect(() =>
        adapter.editMessage("thread", "msg", { text: "edited" })
      ).toThrow(NOT_SUPPORTED_PATTERN);
    });

    it("deleteMessage throws", () => {
      expect(() => adapter.deleteMessage("thread", "msg")).toThrow(
        NOT_SUPPORTED_PATTERN
      );
    });

    it("addReaction throws", () => {
      expect(() => adapter.addReaction("thread", "msg", "thumbsup")).toThrow(
        NOT_SUPPORTED_PATTERN
      );
    });

    it("removeReaction throws", () => {
      expect(() => adapter.removeReaction("thread", "msg", "thumbsup")).toThrow(
        NOT_SUPPORTED_PATTERN
      );
    });

    it("startTyping throws", () => {
      expect(() => adapter.startTyping("thread")).toThrow(
        NOT_SUPPORTED_PATTERN
      );
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
      expect(threadId).toMatch(OPEN_DM_THREAD_PATTERN);
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
      const result = await adapter.fetchMessages(
        "resend:user@example.com:abc123"
      );
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

  describe("createResendAdapter", () => {
    it("returns a ResendAdapter instance with correct name", () => {
      const instance = createResendAdapter({ fromAddress: "bot@example.com" });
      expect(instance).toBeInstanceOf(ResendAdapter);
      expect(instance.name).toBe("resend");
    });
  });

  describe("handleWebhook", () => {
    it("throws when webhook secret is missing", async () => {
      const noSecretAdapter = new ResendAdapter({
        ...config,
        webhookSecret: undefined,
      });
      const env = process.env.RESEND_WEBHOOK_SECRET;
      process.env.RESEND_WEBHOOK_SECRET = "";

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
        "Webhook secret is required"
      );

      if (env) {
        process.env.RESEND_WEBHOOK_SECRET = env;
      }
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
      expect(threadIdArg).toMatch(WEBHOOK_THREAD_PATTERN);
      expect(messageArg.id).toBe("re_webhook_123");
      expect(messageArg.text).toBe("Hello from webhook!");
      expect(messageArg.author.userId).toBe("sender@example.com");
      expect(messageArg.raw.subject).toBe("Test webhook email");
    });
  });
});
