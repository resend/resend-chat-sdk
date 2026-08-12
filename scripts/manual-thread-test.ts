import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { Lock, StateAdapter } from "chat";
import { Chat } from "chat";
import { createResendAdapter } from "../src/index.js";

const TESTER_ADDRESS = "gabriel@resend.com";

const apiKey = process.env.RESEND_API_KEY;
const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
const fromAddress = process.env.FROM_ADDRESS;
if (!(apiKey && webhookSecret && fromAddress)) {
  console.error(
    "Required env vars: RESEND_API_KEY, RESEND_WEBHOOK_SECRET, FROM_ADDRESS"
  );
  process.exit(1);
}

const stateFile = process.env.STATE_FILE || "scripts/.manual-thread-state.json";

interface FileState {
  kv: Record<string, { expiresAt: number | null; value: unknown }>;
  lists: Record<string, unknown[]>;
  subscriptions: string[];
}

class FileStateAdapter implements StateAdapter {
  private readonly data: FileState = { kv: {}, lists: {}, subscriptions: [] };
  private readonly locks = new Map<string, Lock>();

  constructor(private readonly path: string) {
    try {
      this.data = JSON.parse(readFileSync(path, "utf-8"));
      console.log(`[state] loaded ${path}`);
    } catch {
      console.log(`[state] starting fresh at ${path}`);
    }
  }

  private save(): void {
    writeFileSync(this.path, JSON.stringify(this.data, null, 2));
  }

  connect(): Promise<void> {
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    return Promise.resolve();
  }

  get<T = unknown>(key: string): Promise<T | null> {
    const entry = this.data.kv[key];
    if (!entry || (entry.expiresAt && entry.expiresAt < Date.now())) {
      return Promise.resolve(null);
    }
    return Promise.resolve(entry.value as T);
  }

  set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    this.data.kv[key] = {
      value,
      expiresAt: ttlMs ? Date.now() + ttlMs : null,
    };
    this.save();
    return Promise.resolve();
  }

  async setIfNotExists(
    key: string,
    value: unknown,
    ttlMs?: number
  ): Promise<boolean> {
    if ((await this.get(key)) !== null) {
      return false;
    }
    await this.set(key, value, ttlMs);
    return true;
  }

  delete(key: string): Promise<void> {
    delete this.data.kv[key];
    this.save();
    return Promise.resolve();
  }

  appendToList(
    key: string,
    value: unknown,
    options?: { maxLength?: number; ttlMs?: number }
  ): Promise<void> {
    const list = this.data.lists[key] || [];
    list.push(value);
    this.data.lists[key] = options?.maxLength
      ? list.slice(-options.maxLength)
      : list;
    this.save();
    return Promise.resolve();
  }

  getList<T = unknown>(key: string): Promise<T[]> {
    return Promise.resolve((this.data.lists[key] || []) as T[]);
  }

  subscribe(threadId: string): Promise<void> {
    if (!this.data.subscriptions.includes(threadId)) {
      this.data.subscriptions.push(threadId);
      this.save();
    }
    return Promise.resolve();
  }

  unsubscribe(threadId: string): Promise<void> {
    this.data.subscriptions = this.data.subscriptions.filter(
      (id) => id !== threadId
    );
    this.save();
    return Promise.resolve();
  }

  isSubscribed(threadId: string): Promise<boolean> {
    return Promise.resolve(this.data.subscriptions.includes(threadId));
  }

  acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
    const existing = this.locks.get(threadId);
    if (existing && existing.expiresAt > Date.now()) {
      return Promise.resolve(null);
    }
    const lock: Lock = {
      threadId,
      token: Math.random().toString(36).slice(2),
      expiresAt: Date.now() + ttlMs,
    };
    this.locks.set(threadId, lock);
    return Promise.resolve(lock);
  }

  extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    const existing = this.locks.get(lock.threadId);
    if (existing?.token !== lock.token) {
      return Promise.resolve(false);
    }
    existing.expiresAt = Date.now() + ttlMs;
    return Promise.resolve(true);
  }

  releaseLock(lock: Lock): Promise<void> {
    if (this.locks.get(lock.threadId)?.token === lock.token) {
      this.locks.delete(lock.threadId);
    }
    return Promise.resolve();
  }

  forceReleaseLock(threadId: string): Promise<void> {
    this.locks.delete(threadId);
    return Promise.resolve();
  }
}

const resend = createResendAdapter({
  apiKey,
  webhookSecret,
  fromAddress,
  fromName: "Thread Persistence Test",
});

const chat = new Chat({
  userName: "thread-test-bot",
  adapters: { resend },
  state: new FileStateAdapter(stateFile),
});

let replyCounter = 0;

chat.onNewMention(async (thread, message) => {
  if (message.author.userId !== TESTER_ADDRESS) {
    console.log(`[skip] ignoring email from ${message.author.userId}`);
    return;
  }
  console.log(`[new thread] ${thread.id}`);
  console.log(`[inbound] "${message.text?.slice(0, 80)}"`);
  await thread.subscribe();
  replyCounter += 1;
  await thread.post(
    `Reply #${replyCounter} from pid ${process.pid}. Restart me and reply to this email — my next reply should stay in this same conversation.`
  );
  console.log("[sent] reply posted, check your inbox threading");
});

chat.onSubscribedMessage(async (thread, message) => {
  if (message.author.userId !== TESTER_ADDRESS) {
    return;
  }
  console.log(`[follow-up] on ${thread.id}`);
  replyCounter += 1;
  await thread.post(
    `Reply #${replyCounter} from pid ${process.pid}. If you see this inside the same conversation (subject "Re: ..."), threading survived.`
  );
  console.log("[sent] follow-up reply posted");
});

const port = Number(process.env.PORT) || 3000;

const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/webhook") {
    console.log(`[404] ${req.method} ${req.url} (expected POST /webhook)`);
    res.writeHead(404).end();
    return;
  }
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value) {
        headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
    }
    const result = await chat.webhooks.resend(
      new Request(`http://localhost:${port}/webhook`, {
        method: "POST",
        headers,
        body: Buffer.concat(chunks).toString(),
      })
    );
    console.log(`[webhook] handled with status ${result.status}`);
    res.writeHead(result.status).end();
  } catch (err) {
    console.error("[webhook error]", (err as Error).stack || err);
    res.writeHead(500).end();
  }
});

server.listen(port, () => {
  console.log(`pid ${process.pid} listening on http://localhost:${port}`);
  console.log("");
  console.log("Test plan:");
  console.log("  1. Point a Resend email.received webhook at this server");
  console.log(`     (e.g. ngrok http ${port} -> https://<tunnel>/webhook)`);
  console.log(`  2. Email ${fromAddress} from ${TESTER_ADDRESS}`);
  console.log("  3. Check the reply threads into the same conversation");
  console.log("  4. Kill this process (Ctrl+C) and start it again");
  console.log("  5. Reply to the bot's email from your inbox");
  console.log(
    "  6. The bot's next reply should still be in the same conversation"
  );
  console.log("");
  console.log(`Threading state persists in ${stateFile} across restarts.`);
  console.log("Delete that file to reproduce the old (broken) behavior.");
});
