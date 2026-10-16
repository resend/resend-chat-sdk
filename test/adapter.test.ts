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
const mockInboxEmailGet = vi.fn();
const mockInboxEmailList = vi.fn();
const mockInboxEmailReply = vi.fn();
const mockInboxGet = vi.fn();

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
    inboxes: {
      get: mockInboxGet,
      threads: {
        emails: {
          get: mockInboxEmailGet,
          list: mockInboxEmailList,
          reply: mockInboxEmailReply,
        },
      },
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

    it("throws without API key", () => {
      const noKeyAdapter = new ResendAdapter({
        ...config,
        apiKey: undefined,
      });
      const env = process.env.RESEND_API_KEY;
      process.env.RESEND_API_KEY = "";
      expect(() =>
        noKeyAdapter.initialize({ processMessage: vi.fn() })
      ).toThrow();
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

    it("forwards WebhookOptions (waitUntil) to chat.processMessage", async () => {
      const mockChat = { processMessage: vi.fn() };
      await adapter.initialize(mockChat);

      const webhookPayload = {
        type: "email.received",
        created_at: "2025-01-15T10:30:00Z",
        data: {
          email_id: "re_webhook_456",
          from: "sender@example.com",
          to: ["bot@example.com"],
          subject: "Another webhook email",
          message_id: "<webhook-msg-2@mail.resend.dev>",
        },
      };

      const fullEmail = {
        id: "re_webhook_456",
        from: "sender@example.com",
        to: ["bot@example.com"],
        subject: "Another webhook email",
        message_id: "<webhook-msg-2@mail.resend.dev>",
        text: "Hello again!",
        html: "<p>Hello again!</p>",
        headers: {},
        created_at: "2025-01-15T10:30:00Z",
      };

      mockVerify.mockReturnValue(webhookPayload);
      mockReceivingGet.mockResolvedValue({ data: fullEmail });

      const request = new Request("https://example.com/webhook", {
        method: "POST",
        headers: {
          "svix-id": "msg_456",
          "svix-timestamp": "12345",
          "svix-signature": "v1,valid",
        },
        body: JSON.stringify(webhookPayload),
      });

      const waitUntil = vi.fn();
      await adapter.handleWebhook(request, { waitUntil });

      expect(mockChat.processMessage).toHaveBeenCalledOnce();
      const optionsArg = mockChat.processMessage.mock.calls[0][3];
      expect(optionsArg).toEqual({ waitUntil });
    });
  });
});

describe("ResendAdapter with an inbox", () => {
  const INBOX_ID = "b3e2b2b6-3f0e-4c8e-9ad3-2f43a1e2c7f1";
  const THREAD_ID = "7c1f0a2e-5d3b-4e8a-9f61-2b8d4c6e1a90";
  const EMAIL_ID = "4ef9a417-02e9-4d39-ad75-9611e0fcc33c";
  const CHAT_THREAD_ID = `resend:${INBOX_ID}:${THREAD_ID}`;

  const inboxEmail = {
    id: EMAIL_ID,
    direction: "inbound",
    from: "Ada Lovelace <ada@example.org>",
    to: ["agent@example.com"],
    cc: [],
    bcc: [],
    reply_to: [],
    subject: "Refund for order 1041",
    message_id: "<1041@example.org>",
    html: "<p>Could I get a refund?</p>",
    text: "Could I get a refund?",
    attachments: [],
    read: false,
    received_at: "2026-08-05T14:03:11.229Z",
  };

  const inboxPayload = {
    type: "inbox.email.received",
    created_at: "2026-08-05T14:03:12.000Z",
    data: {
      source: "system",
      inbox_id: INBOX_ID,
      thread_id: THREAD_ID,
      email_id: EMAIL_ID,
    },
  };

  function webhookRequest(payload: unknown): Request {
    return new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "svix-id": "msg_123",
        "svix-timestamp": "12345",
        "svix-signature": "v1,valid",
      },
      body: JSON.stringify(payload),
    });
  }

  let adapter: ResendAdapter;
  let mockChat: { processMessage: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockInboxEmailGet.mockResolvedValue({ data: inboxEmail, error: null });
    mockInboxEmailReply.mockResolvedValue({
      data: { id: "6a0c8e58-3d9e-4f7a-8b14-2e3f4a5b6c71" },
      error: null,
    });
    adapter = new ResendAdapter({
      ...config,
      fromAddress: "agent@example.com",
      inboxId: INBOX_ID,
    });
    mockChat = { processMessage: vi.fn() };
    await adapter.initialize(mockChat);
  });

  it("derives the channel and thread info from the inbox thread ID", async () => {
    expect(adapter.channelIdFromThreadId(CHAT_THREAD_ID)).toBe(
      `resend:${INBOX_ID}`
    );
    await expect(adapter.fetchThread(CHAT_THREAD_ID)).resolves.toMatchObject({
      channelId: `resend:${INBOX_ID}`,
      metadata: { inboxId: INBOX_ID, inboxThreadId: THREAD_ID },
    });
  });

  it("fetches the inbox email and processes it in the inbox thread", async () => {
    mockVerify.mockReturnValue(inboxPayload);

    const result = await adapter.handleWebhook(webhookRequest(inboxPayload));

    expect(result.status).toBe(200);
    expect(mockInboxEmailGet).toHaveBeenCalledWith({
      inboxId: INBOX_ID,
      threadId: THREAD_ID,
      emailId: EMAIL_ID,
    });
    expect(mockReceivingGet).not.toHaveBeenCalled();
    expect(mockChat.processMessage).toHaveBeenCalledOnce();
    const [, threadIdArg, messageArg] = mockChat.processMessage.mock.calls[0];
    expect(threadIdArg).toBe(CHAT_THREAD_ID);
    expect(messageArg.text).toBe("Could I get a refund?");
    expect(messageArg.author.userId).toBe("ada@example.org");
    expect(messageArg.raw.inboxThreadId).toBe(THREAD_ID);
  });

  it("ignores email.received events", async () => {
    const payload = { type: "email.received", data: { email_id: "re_1" } };
    mockVerify.mockReturnValue(payload);

    const result = await adapter.handleWebhook(webhookRequest(payload));

    expect(result.status).toBe(200);
    expect(mockReceivingGet).not.toHaveBeenCalled();
    expect(mockChat.processMessage).not.toHaveBeenCalled();
  });

  it("replies in the inbox thread to the last received email", async () => {
    mockVerify.mockReturnValue(inboxPayload);
    await adapter.handleWebhook(webhookRequest(inboxPayload));

    const result = await adapter.postMessage(CHAT_THREAD_ID, {
      markdown: "**Refund issued.**",
    });

    expect(mockInboxEmailReply).toHaveBeenCalledWith({
      inboxId: INBOX_ID,
      threadId: THREAD_ID,
      emailId: EMAIL_ID,
      html: expect.stringContaining("<strong>Refund issued.</strong>"),
      text: "Refund issued.",
    });
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockInboxEmailList).not.toHaveBeenCalled();
    expect(result.id).toBe("6a0c8e58-3d9e-4f7a-8b14-2e3f4a5b6c71");
    expect(result.threadId).toBe(CHAT_THREAD_ID);
    expect(result.raw).toMatchObject({
      inboxId: INBOX_ID,
      inboxThreadId: THREAD_ID,
      subject: "Re: Refund for order 1041",
    });
  });

  it("finds the last received email when the thread has no tracked email", async () => {
    mockInboxEmailList
      .mockResolvedValueOnce({
        data: {
          object: "list",
          has_more: true,
          data: [
            { id: "email_1", direction: "inbound" },
            { id: "email_2", direction: "outbound" },
          ],
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          object: "list",
          has_more: false,
          data: [
            { id: "email_3", direction: "inbound" },
            { id: "email_4", direction: "outbound" },
          ],
        },
        error: null,
      });

    await adapter.postMessage(CHAT_THREAD_ID, "Following up.");

    expect(mockInboxEmailList).toHaveBeenNthCalledWith(1, {
      inboxId: INBOX_ID,
      threadId: THREAD_ID,
      limit: 100,
    });
    expect(mockInboxEmailList).toHaveBeenNthCalledWith(2, {
      inboxId: INBOX_ID,
      threadId: THREAD_ID,
      limit: 100,
      after: "email_2",
    });
    expect(mockInboxEmailReply).toHaveBeenCalledWith(
      expect.objectContaining({ emailId: "email_3" })
    );
  });

  it("throws when the inbox thread has no email", async () => {
    mockInboxEmailList.mockResolvedValue({
      data: { object: "list", has_more: false, data: [] },
      error: null,
    });

    await expect(adapter.postMessage(CHAT_THREAD_ID, "Hello")).rejects.toThrow(
      "has no email to reply to"
    );
    expect(mockInboxEmailReply).not.toHaveBeenCalled();
  });

  it("throws when the reply API returns an error", async () => {
    mockVerify.mockReturnValue(inboxPayload);
    await adapter.handleWebhook(webhookRequest(inboxPayload));
    mockInboxEmailReply.mockResolvedValue({
      data: null,
      error: { message: "Thread not found" },
    });

    await expect(adapter.postMessage(CHAT_THREAD_ID, "Hello")).rejects.toThrow(
      "Failed to reply in inbox thread: Thread not found"
    );
  });

  it("does not get the inbox when inboxId is set", async () => {
    mockVerify.mockReturnValue(inboxPayload);

    await adapter.handleWebhook(webhookRequest(inboxPayload));

    expect(mockInboxGet).not.toHaveBeenCalled();
  });

  it("keeps sending openDM threads with the emails API", async () => {
    const threadId = await adapter.openDM("user@example.com");

    await adapter.postMessage(threadId, "Hello");

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: ["user@example.com"] })
    );
    expect(mockInboxEmailReply).not.toHaveBeenCalled();
  });
});

describe("ResendAdapter with an inbox email address", () => {
  const INBOX_ID = "b3e2b2b6-3f0e-4c8e-9ad3-2f43a1e2c7f1";
  const INBOX_ADDRESS = "agent@example.com";
  const THREAD_ID = "7c1f0a2e-5d3b-4e8a-9f61-2b8d4c6e1a90";
  const EMAIL_ID = "4ef9a417-02e9-4d39-ad75-9611e0fcc33c";

  const inboxPayload = {
    type: "inbox.email.received",
    created_at: "2026-08-05T14:03:12.000Z",
    data: {
      source: "system",
      inbox_id: INBOX_ID,
      thread_id: THREAD_ID,
      email_id: EMAIL_ID,
    },
  };

  function webhookRequest(payload: unknown): Request {
    return new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "svix-id": "msg_123",
        "svix-timestamp": "12345",
        "svix-signature": "v1,valid",
      },
      body: JSON.stringify(payload),
    });
  }

  let adapter: ResendAdapter;
  let mockChat: { processMessage: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockInboxGet.mockResolvedValue({
      data: { object: "inbox", id: INBOX_ID, email_address: INBOX_ADDRESS },
      error: null,
    });
    mockInboxEmailGet.mockResolvedValue({
      data: {
        id: EMAIL_ID,
        direction: "inbound",
        from: "ada@example.org",
        to: [INBOX_ADDRESS],
        cc: [],
        bcc: [],
        reply_to: [],
        subject: "Refund for order 1041",
        message_id: "<1041@example.org>",
        html: null,
        text: "Could I get a refund?",
        attachments: [],
        read: false,
        received_at: "2026-08-05T14:03:11.229Z",
      },
      error: null,
    });
    adapter = new ResendAdapter({
      ...config,
      fromAddress: INBOX_ADDRESS,
      inboxEmailAddress: INBOX_ADDRESS,
    });
    mockChat = { processMessage: vi.fn() };
    await adapter.initialize(mockChat);
  });

  it("resolves the address and processes the email in the inbox thread", async () => {
    mockVerify.mockReturnValue(inboxPayload);

    const result = await adapter.handleWebhook(webhookRequest(inboxPayload));

    expect(result.status).toBe(200);
    expect(mockInboxGet).toHaveBeenCalledWith(INBOX_ADDRESS);
    expect(mockInboxEmailGet).toHaveBeenCalledWith({
      inboxId: INBOX_ID,
      threadId: THREAD_ID,
      emailId: EMAIL_ID,
    });
    const [, threadIdArg] = mockChat.processMessage.mock.calls[0];
    expect(threadIdArg).toBe(`resend:${INBOX_ID}:${THREAD_ID}`);
  });

  it("gets the inbox once", async () => {
    mockVerify.mockReturnValue(inboxPayload);

    await adapter.handleWebhook(webhookRequest(inboxPayload));
    await adapter.handleWebhook(webhookRequest(inboxPayload));

    expect(mockInboxGet).toHaveBeenCalledOnce();
    expect(mockChat.processMessage).toHaveBeenCalledTimes(2);
  });

  it("throws when the inbox does not exist", async () => {
    mockVerify.mockReturnValue(inboxPayload);
    mockInboxGet.mockResolvedValue({
      data: null,
      error: { message: "Inbox not found", name: "not_found", statusCode: 404 },
    });

    await expect(
      adapter.handleWebhook(webhookRequest(inboxPayload))
    ).rejects.toThrow(`Inbox ${INBOX_ADDRESS} does not exist`);
    expect(mockChat.processMessage).not.toHaveBeenCalled();
  });

  it("throws when both inboxId and inboxEmailAddress are set", () => {
    expect(
      () =>
        new ResendAdapter({
          ...config,
          inboxId: INBOX_ID,
          inboxEmailAddress: INBOX_ADDRESS,
        } as unknown as ResendAdapterConfig)
    ).toThrow("Set inboxId or inboxEmailAddress, not both.");
  });
});
