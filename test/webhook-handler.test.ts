import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebhookHandler } from "../src/webhook-handler.js";

// Mock resend client — matches real SDK shapes
const mockVerify = vi.fn();
const mockReceivingGet = vi.fn();

const mockResend = {
  webhooks: { verify: mockVerify },
  emails: { receiving: { get: mockReceivingGet } },
};

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
});
