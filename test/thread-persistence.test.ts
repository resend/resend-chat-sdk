import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { MemoryStateAdapter } from "@chat-adapter/state-memory";
import { Chat } from "chat";
import { Webhook } from "svix";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ResendAdapter } from "../src/adapter.js";

const WEBHOOK_SECRET = `whsec_${Buffer.from("thread-persistence-test-secret").toString("base64")}`;

const RECEIVING_URL_RE = /^\/emails\/receiving\/(.+)$/;

interface SentEmail {
  from: string;
  headers?: Record<string, string>;
  html?: string;
  subject: string;
  text?: string;
  to: string[];
}

let server: Server;
let sentEmails: SentEmail[] = [];
const inboundEmails = new Map<string, Record<string, unknown>>();
let createResendAdapter: typeof import("../src/index.js")["createResendAdapter"];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.method === "POST" && req.url === "/emails") {
        sentEmails.push(JSON.parse(body));
        res.end(JSON.stringify({ id: `re_sent_${sentEmails.length}` }));
        return;
      }
      const inboundId = req.url?.match(RECEIVING_URL_RE)?.[1];
      const email = inboundId ? inboundEmails.get(inboundId) : undefined;
      if (req.method === "GET" && email) {
        res.end(JSON.stringify(email));
        return;
      }
      res.statusCode = 404;
      res.end(
        JSON.stringify({
          name: "not_found",
          message: `no route for ${req.method} ${req.url}`,
        })
      );
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  process.env.RESEND_BASE_URL = `http://127.0.0.1:${port}`;
  ({ createResendAdapter } = await import("../src/index.js"));
});

afterAll(() => {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

beforeEach(() => {
  sentEmails = [];
});

function createProcess(state: MemoryStateAdapter): {
  chat: Chat<{ resend: ResendAdapter }>;
  resend: ResendAdapter;
} {
  const resend = createResendAdapter({
    apiKey: "re_test_123",
    webhookSecret: WEBHOOK_SECRET,
    fromAddress: "bot@example.com",
  });
  const chat = new Chat({
    userName: "email-bot",
    adapters: { resend },
    state,
  });
  return { chat, resend };
}

let inboundCounter = 0;

async function deliverInboundEmail(
  chat: Chat<{ resend: ResendAdapter }>
): Promise<{ messageId: string }> {
  inboundCounter += 1;
  const emailId = `re_inbound_${inboundCounter}`;
  const messageId = `<inbound-${inboundCounter}@mail.example.com>`;
  inboundEmails.set(emailId, {
    id: emailId,
    from: "customer@example.com",
    to: ["bot@example.com"],
    subject: "Help with my order",
    message_id: messageId,
    text: "Where is my package?",
    html: "<p>Where is my package?</p>",
    headers: {},
    created_at: "2025-01-15T10:30:00Z",
  });

  const payload = JSON.stringify({
    type: "email.received",
    created_at: "2025-01-15T10:30:00Z",
    data: {
      email_id: emailId,
      from: "customer@example.com",
      to: ["bot@example.com"],
      subject: "Help with my order",
      message_id: messageId,
    },
  });

  const svixId = `msg_${inboundCounter}`;
  const timestamp = new Date();
  const signature = new Webhook(WEBHOOK_SECRET).sign(
    svixId,
    timestamp,
    payload
  );

  const tasks: Promise<unknown>[] = [];
  const response = await chat.webhooks.resend(
    new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "svix-id": svixId,
        "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
        "svix-signature": signature,
      },
      body: payload,
    }),
    { waitUntil: (task) => tasks.push(task) }
  );
  if (response.status !== 200) {
    throw new Error(`webhook rejected with status ${response.status}`);
  }
  await Promise.all(tasks);

  return { messageId };
}

describe("threading state across processes", () => {
  it("threads the reply when the same process handles inbound and outbound", async () => {
    const { chat } = createProcess(new MemoryStateAdapter());
    chat.onNewMention(async (thread, message) => {
      await thread.subscribe();
      await thread.post(`Echo: ${message.text}`);
    });

    const { messageId } = await deliverInboundEmail(chat);

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toEqual(["customer@example.com"]);
    expect(sentEmails[0].subject).toBe("Re: Help with my order");
    expect(sentEmails[0].headers?.["In-Reply-To"]).toBe(messageId);
    expect(sentEmails[0].headers?.References).toContain(messageId);
  });

  it("threads the reply when a different process sends the outbound", async () => {
    const state = new MemoryStateAdapter();

    const inboundProcess = createProcess(state);
    let threadId = "";
    inboundProcess.chat.onNewMention(async (thread) => {
      await thread.subscribe();
      threadId = thread.id;
    });
    const { messageId } = await deliverInboundEmail(inboundProcess.chat);
    expect(threadId).not.toBe("");

    const outboundProcess = createProcess(state);
    await outboundProcess.chat.initialize();
    await outboundProcess.resend.postMessage(threadId, "It ships tomorrow.");

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].subject).toBe("Re: Help with my order");
    expect(sentEmails[0].headers?.["In-Reply-To"]).toBe(messageId);
    expect(sentEmails[0].headers?.References).toContain(messageId);
  });
});
