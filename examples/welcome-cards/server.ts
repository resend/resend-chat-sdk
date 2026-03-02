// Load .env manually (no dotenv dep)
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { MemoryStateAdapter } from "@chat-adapter/state-memory";
import type { CardElement } from "chat";
import { Chat } from "chat";
import { createResendAdapter } from "resend-chat-sdk";

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
  userName: "email-bot",
  adapters: { resend },
  state: new MemoryStateAdapter(),
});

// Build the welcome card
const welcomeCard: CardElement = {
  type: "card",
  title: "Welcome!",
  subtitle: "Thanks for reaching out",
  children: [
    {
      type: "text",
      content: "Hi! Thanks for emailing us. We'll get back to you shortly.",
    },
    { type: "divider" },
    {
      type: "actions",
      children: [
        {
          type: "link-button",
          label: "Visit our website",
          url: "https://resend.com",
        },
      ],
    },
  ],
};

// New inbound email — send a welcome card
chat.onNewMention(async (thread, message) => {
  console.log(
    `[new mention] from=${message.author.userId} text="${message.text}"`
  );
  await thread.subscribe();
  await thread.post({
    card: welcomeCard,
    fallbackText: "Welcome! Thanks for reaching out.",
  });
});

// Follow-up emails in subscribed threads
chat.onSubscribedMessage(async (thread, message) => {
  console.log(
    `[subscribed] from=${message.author.userId} text="${message.text}"`
  );
  await thread.post("Got your follow-up! We're on it.");
});

const port = Number(process.env.PORT) || 3000;

const server = createServer(async (req, res) => {
  // Health check
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("welcome-cards example is running");
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
