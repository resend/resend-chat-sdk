// Load .env manually (no dotenv dep)
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { MemoryStateAdapter } from "@chat-adapter/state-memory";
import { createResendAdapter } from "@resend/chat-sdk-adapter";
import { Chat } from "chat";

try {
  const env = readFileSync(".env", "utf-8");
  for (const line of env.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const key = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1);
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
} catch {
  // no .env file — rely on env vars
}

const fromAddress = process.env.FROM_ADDRESS;
if (!fromAddress) {
  console.error("FROM_ADDRESS env var is required");
  process.exit(1);
}

// Create adapter first so we can call openDM / postMessage directly
const resend = createResendAdapter({
  fromAddress,
  fromName: process.env.FROM_NAME,
});

const chat = new Chat({
  userName: "notification-bot",
  adapters: { resend },
  state: new MemoryStateAdapter(),
});

// Log any inbound replies to notifications
chat.onNewMention(async (_thread, message) => {
  console.log(`[reply] from=${message.author.userId} text="${message.text}"`);
});

const port = Number(process.env.PORT) || 3000;

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString();
}

function toWebRequest(req: IncomingMessage, body: string): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value) {
      headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
  }
  return new Request(`http://localhost:${port}${req.url}`, {
    method: "POST",
    headers,
    body,
  });
}

async function handleWebhook(req: IncomingMessage, res: ServerResponse) {
  try {
    const body = await readBody(req);
    const webRequest = toWebRequest(req, body);
    console.log("[webhook] received, forwarding to adapter...");
    const result = await chat.webhooks.resend(webRequest);
    const resultBody = await result.text();
    console.log(`[webhook] response: ${result.status} ${resultBody}`);
    res.writeHead(result.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: result.status === 200 }));
  } catch (err) {
    console.error("[webhook error]", (err as Error).stack || err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal server error" }));
  }
}

async function handleNotify(req: IncomingMessage, res: ServerResponse) {
  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw) as {
      to: string;
      subject?: string;
      message: string;
    };

    if (!(body.to && body.message)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: '"to" and "message" are required' }));
      return;
    }

    const dmThreadId = await resend.openDM(body.to);
    await resend.postMessage(dmThreadId, body.message);

    console.log(`[notify] sent to=${body.to} threadId=${dmThreadId}`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, threadId: dmThreadId }));
  } catch (err) {
    console.error("[notify error]", (err as Error).stack || err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal server error" }));
  }
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("notifications example is running");
    return;
  }

  if (req.method === "POST" && req.url === "/webhook") {
    await handleWebhook(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/notify") {
    await handleNotify(req, res);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
});

server.listen(port, () => {
  console.log(`Listening on http://localhost:${port}`);
  console.log(`Webhook URL: http://localhost:${port}/webhook`);
  console.log(`Notify URL:  POST http://localhost:${port}/notify`);
  console.log(`From: ${fromAddress}`);
});
