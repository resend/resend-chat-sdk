// Load .env manually (no dotenv dep)
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { ResendRawMessage } from "@chat-adapter/resend";
import { createResendAdapter } from "@chat-adapter/resend";
import { MemoryStateAdapter } from "@chat-adapter/state-memory";
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

const resend = createResendAdapter({
  fromAddress,
  fromName: process.env.FROM_NAME,
});

const chat = new Chat({
  userName: "support-bot",
  adapters: { resend },
  state: new MemoryStateAdapter(),
});

// New inbound email — create a support ticket
chat.onNewMention(async (thread, message) => {
  const raw = message.raw as ResendRawMessage;
  console.log(
    `[new ticket] from=${message.author.userId} subject=${raw.subject} text="${message.text}"`
  );
  await thread.subscribe();
  await thread.post(
    "Thanks for contacting support! Your ticket has been created. We'll follow up shortly.\n\nTicket ID: " +
      message.id
  );
});

// Follow-up emails in subscribed threads
chat.onSubscribedMessage(async (thread, message) => {
  console.log(
    `[follow-up] from=${message.author.userId} text="${message.text}"`
  );

  const text = message.text.toLowerCase();

  if (text.includes("status")) {
    await thread.post(
      "Your ticket is being reviewed by our team. Current status: In Progress"
    );
  } else if (text.includes("close")) {
    await thread.post("Ticket closed. Thanks for contacting support!");
    await thread.unsubscribe();
  } else {
    await thread.post(
      "Got your message. A support agent will respond shortly."
    );
  }
});

const port = Number(process.env.PORT) || 3000;

const server = createServer(async (req, res) => {
  // Health check
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("support bot example is running");
    return;
  }

  // Webhook endpoint
  if (req.method === "POST" && req.url === "/webhook") {
    try {
      // Collect body
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const body = Buffer.concat(chunks).toString();

      // Build a Web Request from the Node.js IncomingMessage
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value) {
          headers.set(key, Array.isArray(value) ? value.join(", ") : value);
        }
      }

      const webRequest = new Request(`http://localhost:${port}${req.url}`, {
        method: "POST",
        headers,
        body,
      });

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
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
});

server.listen(port, () => {
  console.log(`Listening on http://localhost:${port}`);
  console.log(`Webhook URL: http://localhost:${port}/webhook`);
  console.log(`From: ${fromAddress}`);
});
