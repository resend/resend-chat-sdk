import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebhookHandler } from "../src/webhook-handler.js";

// Mock resend client — matches real SDK shapes
const mockVerify = vi.fn();
const mockReceivingGet = vi.fn();
const mockInboxEmailGet = vi.fn();

const mockResend = {
  webhooks: { verify: mockVerify },
  emails: { receiving: { get: mockReceivingGet } },
  inboxes: { threads: { emails: { get: mockInboxEmailGet } } },
};

const INBOX_ID = "b3e2b2b6-3f0e-4c8e-9ad3-2f43a1e2c7f1";
const THREAD_ID = "7c1f0a2e-5d3b-4e8a-9f61-2b8d4c6e1a90";
const EMAIL_ID = "4ef9a417-02e9-4d39-ad75-9611e0fcc33c";

const inboxPayload = {
  type: "inbox.email.received",
  created_at: "2026-09-29T12:00:00.000Z",
  data: {
    source: "system",
    inbox_id: INBOX_ID,
    thread_id: THREAD_ID,
    email_id: EMAIL_ID,
  },
};

function signedRequest(payload: unknown): Request {
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

describe("WebhookHandler", () => {
  let handler: WebhookHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new WebhookHandler(mockResend as any, "whsec_test123");
  });

  describe("parseWebhookRequest", () => {
    it("returns 401 for invalid signature", async () => {
      mockVerify.mockImplementation(() => {
        throw new Error("Invalid signature");
      });

      const request = new Request("https://example.com/webhook", {
        method: "POST",
        headers: {
          "svix-id": "msg_123",
          "svix-timestamp": "12345",
          "svix-signature": "v1,invalid",
        },
        body: JSON.stringify({ type: "email.received", data: {} }),
      });

      const result = await handler.parseWebhookRequest(request);
      expect(result.status).toBe(401);
    });

    it("returns 200 for non-email.received events", async () => {
      mockVerify.mockReturnValue({ type: "email.sent", data: {} });

      const request = new Request("https://example.com/webhook", {
        method: "POST",
        headers: {
          "svix-id": "msg_123",
          "svix-timestamp": "12345",
          "svix-signature": "v1,valid",
        },
        body: JSON.stringify({ type: "email.sent", data: {} }),
      });

      const result = await handler.parseWebhookRequest(request);
      expect(result.status).toBe(200);
      expect(result.event).toBeNull();
    });

    it("returns parsed event for email.received", async () => {
      const payload = {
        type: "email.received",
        created_at: "2025-01-01T00:00:00Z",
        data: {
          email_id: "re_123",
          from: "user@example.com",
          to: ["bot@example.com"],
          subject: "Test",
          message_id: "<test@mail.resend.dev>",
        },
      };
      mockVerify.mockReturnValue(payload);

      const request = new Request("https://example.com/webhook", {
        method: "POST",
        headers: {
          "svix-id": "msg_123",
          "svix-timestamp": "12345",
          "svix-signature": "v1,valid",
        },
        body: JSON.stringify(payload),
      });

      const result = await handler.parseWebhookRequest(request);
      expect(result.status).toBe(200);
      expect(result.event).not.toBeNull();
      expect(result.event?.data.email_id).toBe("re_123");
    });
  });

  describe("fetchEmailContent", () => {
    it("fetches full email via receiving API", async () => {
      const email = {
        id: "re_123",
        from: "user@example.com",
        to: ["bot@example.com"],
        subject: "Test",
        message_id: "<test@mail.resend.dev>",
        text: "Hello",
        html: "<p>Hello</p>",
        created_at: "2025-01-01T00:00:00Z",
      };
      mockReceivingGet.mockResolvedValue({ data: email });

      const result = await handler.fetchEmailContent("re_123");
      expect(result).toEqual(email);
      expect(mockReceivingGet).toHaveBeenCalledWith("re_123");
    });

    it("throws on null data response", async () => {
      mockReceivingGet.mockResolvedValue({
        data: null,
        error: { message: "Email not found" },
      });

      await expect(handler.fetchEmailContent("re_missing")).rejects.toThrow(
        "Failed to fetch email content: Email not found"
      );
    });

    it("throws on error without message", async () => {
      mockReceivingGet.mockResolvedValue({ data: null, error: {} });

      await expect(handler.fetchEmailContent("re_missing")).rejects.toThrow(
        "Failed to fetch email content: Unknown error"
      );
    });
  });

  describe("inbox mode", () => {
    let inboxHandler: WebhookHandler;

    beforeEach(() => {
      inboxHandler = new WebhookHandler(
        mockResend as any,
        "whsec_test123",
        INBOX_ID
      );
    });

    it("returns the event for inbox.email.received on the inbox", async () => {
      mockVerify.mockReturnValue(inboxPayload);

      const result = await inboxHandler.parseWebhookRequest(
        signedRequest(inboxPayload)
      );
      expect(result.status).toBe(200);
      expect(result.event).toEqual(inboxPayload);
    });

    it("ignores inbox.email.received for another inbox", async () => {
      const payload = {
        ...inboxPayload,
        data: {
          ...inboxPayload.data,
          inbox_id: "00000000-0000-4000-8000-000000000000",
        },
      };
      mockVerify.mockReturnValue(payload);

      const result = await inboxHandler.parseWebhookRequest(
        signedRequest(payload)
      );
      expect(result.status).toBe(200);
      expect(result.event).toBeNull();
    });

    it("ignores email.received", async () => {
      const payload = { type: "email.received", data: { email_id: "re_1" } };
      mockVerify.mockReturnValue(payload);

      const result = await inboxHandler.parseWebhookRequest(
        signedRequest(payload)
      );
      expect(result.status).toBe(200);
      expect(result.event).toBeNull();
    });

    it("returns 401 for an invalid signature", async () => {
      mockVerify.mockImplementation(() => {
        throw new Error("Invalid signature");
      });

      const result = await inboxHandler.parseWebhookRequest(
        signedRequest(inboxPayload)
      );
      expect(result.status).toBe(401);
    });
  });

  it("ignores inbox.email.received without an inbox ID", async () => {
    mockVerify.mockReturnValue(inboxPayload);

    const result = await handler.parseWebhookRequest(
      signedRequest(inboxPayload)
    );
    expect(result.status).toBe(200);
    expect(result.event).toBeNull();
  });

  describe("fetchInboxEmail", () => {
    it("fetches the email of the inbox thread", async () => {
      const email = { id: EMAIL_ID, from: "user@example.com" };
      mockInboxEmailGet.mockResolvedValue({ data: email, error: null });

      const result = await handler.fetchInboxEmail({
        inboxId: INBOX_ID,
        threadId: THREAD_ID,
        emailId: EMAIL_ID,
      });
      expect(result).toEqual(email);
      expect(mockInboxEmailGet).toHaveBeenCalledWith({
        inboxId: INBOX_ID,
        threadId: THREAD_ID,
        emailId: EMAIL_ID,
      });
    });

    it("throws on an error response", async () => {
      mockInboxEmailGet.mockResolvedValue({
        data: null,
        error: { message: "Email not found" },
      });

      await expect(
        handler.fetchInboxEmail({
          inboxId: INBOX_ID,
          threadId: THREAD_ID,
          emailId: EMAIL_ID,
        })
      ).rejects.toThrow("Failed to fetch inbox email: Email not found");
    });
  });
});
