import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResendAdapter } from "../src/adapter.js";
import type { ResendAdapterConfig } from "../src/types.js";

const mockSend = vi.fn();
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
};

async function receiveInboundEmail(adapter: ResendAdapter): Promise<string> {
  const mockChat = { processMessage: vi.fn() };
  await adapter.initialize(mockChat);

  const webhookPayload = {
    type: "email.received",
    created_at: "2025-01-15T10:30:00Z",
    data: {
      email_id: "re_inbound_1",
      from: "customer@example.com",
      to: ["bot@example.com"],
      subject: "Help with my order",
      message_id: "<inbound-1@mail.example.com>",
    },
  };

  mockVerify.mockReturnValue(webhookPayload);
  mockReceivingGet.mockResolvedValue({
    data: {
      id: "re_inbound_1",
      from: "customer@example.com",
      to: ["bot@example.com"],
      subject: "Help with my order",
      message_id: "<inbound-1@mail.example.com>",
      text: "Where is my package?",
      html: "<p>Where is my package?</p>",
      headers: {},
      created_at: "2025-01-15T10:30:00Z",
    },
  });

  const response = await adapter.handleWebhook(
    new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "svix-id": "msg_1",
        "svix-timestamp": "12345",
        "svix-signature": "v1,valid",
      },
      body: JSON.stringify(webhookPayload),
    })
  );
  expect(response.status).toBe(200);

  return mockChat.processMessage.mock.calls[0][1] as string;
}

describe("threading state across processes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockResolvedValue({ data: { id: "re_sent_1" } });
  });

  it("threads the reply when the same process handles inbound and outbound", async () => {
    const adapter = new ResendAdapter(config);
    const threadId = await receiveInboundEmail(adapter);

    await adapter.postMessage(threadId, "It ships tomorrow.");

    const sent = mockSend.mock.calls[0][0];
    expect(sent.subject).toBe("Re: Help with my order");
    expect(sent.headers?.["In-Reply-To"]).toBe("<inbound-1@mail.example.com>");
    expect(sent.headers?.References).toContain("<inbound-1@mail.example.com>");
  });

  it("threads the reply when a different process sends the outbound", async () => {
    const inboundProcess = new ResendAdapter(config);
    const threadId = await receiveInboundEmail(inboundProcess);

    const outboundProcess = new ResendAdapter(config);
    await outboundProcess.initialize({ processMessage: vi.fn() });
    await outboundProcess.postMessage(threadId, "It ships tomorrow.");

    const sent = mockSend.mock.calls[0][0];
    expect(sent.subject).toBe("Re: Help with my order");
    expect(sent.headers?.["In-Reply-To"]).toBe("<inbound-1@mail.example.com>");
    expect(sent.headers?.References).toContain("<inbound-1@mail.example.com>");
  });
});
