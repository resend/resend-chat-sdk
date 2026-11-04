import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { MemoryStateAdapter } from "@chat-adapter/state-memory";
import { Chat } from "chat";
import { Webhook } from "svix";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ResendAdapter } from "../src/adapter.js";

const WEBHOOK_SECRET = `whsec_${Buffer.from("thread-persistence-test-secret").toString("base64")}`;

const RECEIVING_URL_RE = /^\/emails\/receiving\/(.+)$/;
const INBOX_EMAIL_URL_RE =
  /^\/inboxes\/([^/]+)\/threads\/([^/]+)\/emails\/([^/]+)(\/reply)?$/;
const INBOX_DRAFT_URL_RE = /^\/inboxes\/([^/]+)\/drafts(?:\/([^/]+)\/send)?$/;
const INBOX_ID = "b3e2b2b6-3f0e-4c8e-9ad3-2f43a1e2c7f1";
const INBOX_THREAD_ID = "7c1f0a2e-5d3b-4e8a-9f61-2b8d4c6e1a90";

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
let inboxReplies: { body: Record<string, unknown>; url: string }[] = [];
let inboxDrafts: { body: Record<string, unknown>; url: string }[] = [];
let sentDrafts: string[] = [];
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
      const draftMatch = req.url?.match(INBOX_DRAFT_URL_RE);
      if (req.method === "POST" && draftMatch) {
        if (draftMatch[2]) {
          sentDrafts.push(draftMatch[2]);
          res.end(JSON.stringify({ id: `sent_draft_${sentDrafts.length}` }));
          return;
        }
        inboxDrafts.push({ url: req.url ?? "", body: JSON.parse(body) });
        res.end(
          JSON.stringify({
            object: "inbox_draft",
            id: `draft_${inboxDrafts.length}`,
          })
        );
        return;
      }
      const inboxMatch = req.url?.match(INBOX_EMAIL_URL_RE);
      if (inboxMatch) {
        const email = inboundEmails.get(inboxMatch[3]);
        if (req.method === "POST" && inboxMatch[4]) {
          inboxReplies.push({ url: req.url ?? "", body: JSON.parse(body) });
          res.end(JSON.stringify({ id: `sent_${inboxReplies.length}` }));
          return;
        }
        if (req.method === "GET" && email) {
          res.end(JSON.stringify(email));
          return;
        }
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
  inboxReplies = [];
  inboxDrafts = [];
  sentDrafts = [];
});

function createProcess(
  state: MemoryStateAdapter,
  inboxId?: string,
  startInboxThreads?: boolean
): {
  chat: Chat<{ resend: ResendAdapter }>;
  resend: ResendAdapter;
} {
  const resend = createResendAdapter({
    apiKey: "re_test_123",
    webhookSecret: WEBHOOK_SECRET,
    fromAddress: "bot@example.com",
    inboxId,
    startInboxThreads,
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

  await sendWebhook(chat, payload, `msg_${inboundCounter}`);

  return { messageId };
}

async function sendWebhook(
  chat: Chat<{ resend: ResendAdapter }>,
  payload: string,
  svixId: string
): Promise<void> {
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
}

async function deliverInboxEmail(
  chat: Chat<{ resend: ResendAdapter }>,
  threadId = INBOX_THREAD_ID
): Promise<{ emailId: string }> {
  inboundCounter += 1;
  const emailId = `00000000-0000-4000-8000-${String(inboundCounter).padStart(12, "0")}`;
  inboundEmails.set(emailId, {
    id: emailId,
    direction: "inbound",
    from: "Customer <customer@example.com>",
    to: ["bot@example.com"],
    cc: [],
    bcc: [],
    reply_to: [],
    subject: "Help with my order",
    message_id: `<inbound-${inboundCounter}@mail.example.com>`,
    html: "<p>Where is my package?</p>",
    text: "Where is my package?",
    attachments: [],
    read: false,
    received_at: "2026-08-05T14:03:11.229Z",
  });

  const payload = JSON.stringify({
    type: "inbox.email.received",
    created_at: "2026-08-05T14:03:12.000Z",
    data: {
      source: "system",
      inbox_id: INBOX_ID,
      thread_id: threadId,
      email_id: emailId,
    },
  });
  await sendWebhook(chat, payload, `msg_${inboundCounter}`);

  return { emailId };
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

describe("inbox threads across processes", () => {
  it("replies in the inbox thread when the same process handles inbound and outbound", async () => {
    const { chat } = createProcess(new MemoryStateAdapter(), INBOX_ID);
    let threadId = "";
    chat.onNewMention(async (thread, message) => {
      threadId = thread.id;
      await thread.subscribe();
      await thread.post(`Echo: ${message.text}`);
    });

    const { emailId } = await deliverInboxEmail(chat);

    expect(threadId).toBe(`resend:${INBOX_ID}:${INBOX_THREAD_ID}`);
    expect(sentEmails).toHaveLength(0);
    expect(inboxReplies).toHaveLength(1);
    expect(inboxReplies[0].url).toBe(
      `/inboxes/${INBOX_ID}/threads/${INBOX_THREAD_ID}/emails/${emailId}/reply`
    );
    expect(inboxReplies[0].body.text).toBe("Echo: Where is my package?");
  });

  it("replies to the tracked email when a different process sends the outbound", async () => {
    const state = new MemoryStateAdapter();

    const inboundProcess = createProcess(state, INBOX_ID);
    let threadId = "";
    inboundProcess.chat.onNewMention(async (thread) => {
      await thread.subscribe();
      threadId = thread.id;
    });
    const { emailId } = await deliverInboxEmail(inboundProcess.chat);

    const outboundProcess = createProcess(state, INBOX_ID);
    await outboundProcess.chat.initialize();
    await outboundProcess.resend.postMessage(threadId, "It ships tomorrow.");

    expect(inboxReplies).toHaveLength(1);
    expect(inboxReplies[0].url).toBe(
      `/inboxes/${INBOX_ID}/threads/${INBOX_THREAD_ID}/emails/${emailId}/reply`
    );
    expect(inboxReplies[0].body.text).toBe("It ships tomorrow.");
  });

  it("links a thread of openDM across processes with the inbox.draft.sent event", async () => {
    const state = new MemoryStateAdapter();
    const resendThreadId = "9d2e4c1a-6b3f-4e7d-8a52-1c0f3b9e7d64";

    const outboundProcess = createProcess(state, INBOX_ID, true);
    await outboundProcess.chat.initialize();
    const threadId = await outboundProcess.resend.openDM(
      "customer@example.com"
    );
    await state.subscribe(threadId);
    await outboundProcess.resend.postMessage(threadId, "Your order shipped.");

    expect(inboxDrafts).toHaveLength(1);
    expect(inboxDrafts[0].url).toBe(`/inboxes/${INBOX_ID}/drafts`);
    expect(inboxDrafts[0].body).toMatchObject({
      to: ["customer@example.com"],
      subject: "New message",
      text: "Your order shipped.",
    });
    expect(sentDrafts).toEqual(["draft_1"]);

    const eventProcess = createProcess(state, INBOX_ID, true);
    await sendWebhook(
      eventProcess.chat,
      JSON.stringify({
        type: "inbox.draft.sent",
        created_at: "2026-08-05T15:00:01.000Z",
        data: {
          source: "api",
          inbox_id: INBOX_ID,
          thread_id: resendThreadId,
          email_id: "sent_draft_1",
          draft_id: "draft_1",
        },
      }),
      "msg_draft_sent"
    );

    const replyProcess = createProcess(state, INBOX_ID, true);
    let replyThreadId = "";
    replyProcess.chat.onSubscribedMessage(async (thread, message) => {
      replyThreadId = thread.id;
      await thread.post(`Echo: ${message.text}`);
    });
    const { emailId } = await deliverInboxEmail(
      replyProcess.chat,
      resendThreadId
    );

    expect(replyThreadId).toBe(threadId);
    expect(inboxReplies).toHaveLength(1);
    expect(inboxReplies[0].url).toBe(
      `/inboxes/${INBOX_ID}/threads/${resendThreadId}/emails/${emailId}/reply`
    );
    expect(inboxDrafts).toHaveLength(1);
  });
});
