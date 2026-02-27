import { Resend } from "resend";
import type { Root } from "mdast";
import { Message, parseMarkdown } from "chat";
import type { AdapterPostableMessage } from "chat";
import { ThreadResolver } from "./thread-resolver.js";
import { WebhookHandler } from "./webhook-handler.js";
import { ResendFormatConverter } from "./format-converter.js";
import { parseInboundEmail } from "./message-parser.js";
import { renderMessage } from "./message-renderer.js";
import {
  generateMessageId,
  parseEmailAddress,
  hashMessageId,
} from "./utils.js";
import type {
  ResendAdapterConfig,
  ResendThreadId,
  ResendRawMessage,
} from "./types.js";

export interface ChatInstance {
  processMessage(adapter: any, threadId: string, message: any): void;
}

class NotImplementedError extends Error {
  constructor(method: string) {
    super(`${method} is not supported by the Resend adapter`);
    this.name = "NotImplementedError";
  }
}

export class ResendAdapter {
  readonly name = "resend";
  readonly userName: string;

  private config: ResendAdapterConfig;
  private resend: Resend | null = null;
  private chat: ChatInstance | null = null;
  private threadResolver = new ThreadResolver();
  private formatConverter = new ResendFormatConverter();
  private webhookHandler: WebhookHandler | null = null;

  constructor(config: ResendAdapterConfig) {
    this.config = config;
    this.userName = config.fromAddress;
  }

  async initialize(chat: ChatInstance): Promise<void> {
    const apiKey = this.config.apiKey || process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Resend API key is required. Provide it via config.apiKey or RESEND_API_KEY env var.",
      );
    }

    this.resend = new Resend(apiKey);
    this.chat = chat;

    const webhookSecret =
      this.config.webhookSecret || process.env.RESEND_WEBHOOK_SECRET || "";
    this.webhookHandler = new WebhookHandler(this.resend, webhookSecret);
  }

  encodeThreadId(id: ResendThreadId): string {
    return this.threadResolver.encodeThreadId(id);
  }

  decodeThreadId(threadId: string): ResendThreadId {
    return this.threadResolver.decodeThreadId(threadId);
  }

  async handleWebhook(request: Request): Promise<Response> {
    if (!this.webhookHandler || !this.chat) {
      throw new Error("Adapter not initialized. Call initialize() first.");
    }

    const webhookSecret =
      this.config.webhookSecret || process.env.RESEND_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error(
        "Webhook secret is required for webhook verification (config.webhookSecret or RESEND_WEBHOOK_SECRET env)",
      );
    }

    const result = await this.webhookHandler.parseWebhookRequest(request);
    if (!result.event) {
      return new Response(null, { status: result.status });
    }

    const email = await this.webhookHandler.fetchEmailContent(
      result.event.data.email_id,
    );

    const threadId = await this.threadResolver.resolveThreadId({
      toAddress: email.to[0],
      messageId: email.message_id,
      inReplyTo: email.headers?.["In-Reply-To"],
      references: email.headers?.["References"],
    });

    this.threadResolver.trackSubject(threadId, email.subject);

    const parsed = parseInboundEmail(email, threadId);
    await this.chat.processMessage(this, threadId, parsed);

    return new Response(null, { status: 200 });
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<{ id: string; raw: ResendRawMessage; threadId: string }> {
    if (!this.resend) {
      throw new Error("Adapter not initialized. Call initialize() first.");
    }

    // Normalize AdapterPostableMessage to { text?, formatted?, card? }
    let normalized: { text?: string; formatted?: Root; card?: any };
    if (typeof message === "string") {
      normalized = { text: message };
    } else if ("markdown" in message) {
      normalized = { text: (message as any).markdown };
    } else if ("raw" in message) {
      normalized = { text: (message as any).raw };
    } else if ("ast" in message) {
      normalized = { formatted: (message as any).ast as Root };
    } else if ("card" in message) {
      normalized = { card: (message as any).card };
    } else if ("type" in message) {
      // CardElement directly
      normalized = { card: message };
    } else {
      normalized = message as { text?: string; formatted?: Root; card?: any };
    }

    const decoded = this.threadResolver.decodeThreadId(threadId);
    const rendered = await renderMessage(normalized);

    const fromHeader = this.config.fromName
      ? `${this.config.fromName} <${this.config.fromAddress}>`
      : this.config.fromAddress;

    const messageId = generateMessageId(this.config.fromAddress);
    const headers = this.threadResolver.getReplyHeaders(threadId);

    const storedSubject = this.threadResolver.getSubject(threadId);
    const subject = storedSubject
      ? `Re: ${storedSubject}`
      : "New message";

    const response = await this.resend.emails.send({
      from: fromHeader,
      to: [decoded.toAddress],
      subject,
      html: rendered.html,
      text: rendered.text,
      ...(headers && { headers }),
    });

    if (response.error || !response.data) {
      throw new Error(
        `Failed to send email: ${response.error?.message || "Unknown error"}`,
      );
    }

    this.threadResolver.trackMessage(threadId, messageId);

    return {
      id: response.data.id,
      raw: {
        id: response.data.id,
        messageId,
        from: this.config.fromAddress,
        to: [decoded.toAddress],
        subject,
        text: rendered.text,
        html: rendered.html,
        headers: headers || {},
        createdAt: new Date().toISOString(),
      },
      threadId,
    };
  }

  async editMessage(
    _threadId: string,
    _messageId: string,
    _message: any,
  ): Promise<never> {
    throw new NotImplementedError("editMessage");
  }

  async deleteMessage(_threadId: string, _messageId: string): Promise<never> {
    throw new NotImplementedError("deleteMessage");
  }

  async addReaction(
    _threadId: string,
    _messageId: string,
    _reaction: string,
  ): Promise<never> {
    throw new NotImplementedError("addReaction");
  }

  async removeReaction(
    _threadId: string,
    _messageId: string,
    _reaction: string,
  ): Promise<never> {
    throw new NotImplementedError("removeReaction");
  }

  async startTyping(_threadId: string): Promise<never> {
    throw new NotImplementedError("startTyping");
  }

  renderFormatted(content: Root): string {
    return this.formatConverter.fromAst(content);
  }

  async openDM(email: string): Promise<string> {
    const messageId = generateMessageId(email);
    const hash = await hashMessageId(messageId);
    const threadId = this.threadResolver.encodeThreadId({
      toAddress: email,
      rootMessageIdHash: hash,
    });
    this.threadResolver.trackMessage(threadId, messageId);
    return threadId;
  }

  async fetchThread(
    threadId: string,
  ): Promise<{ id: string; channelId: string; metadata: Record<string, unknown> }> {
    const decoded = this.threadResolver.decodeThreadId(threadId);
    return {
      id: threadId,
      channelId: `resend:${decoded.toAddress}`,
      metadata: {
        title: `Conversation with ${decoded.toAddress}`,
        toAddress: decoded.toAddress,
      },
    };
  }

  async fetchMessages(
    _threadId: string,
  ): Promise<{ messages: any[]; nextCursor?: string }> {
    return { messages: [] };
  }

  parseMessage(raw: ResendRawMessage): Message<ResendRawMessage> {
    const authorEmail = parseEmailAddress(raw.from);
    const text = raw.text || "";
    return new Message<ResendRawMessage>({
      id: raw.id,
      threadId: "", // filled in by Chat SDK
      text,
      formatted: parseMarkdown(text),
      raw,
      author: {
        userId: authorEmail,
        fullName: authorEmail,
        userName: authorEmail,
        isBot: false,
        isMe: authorEmail === this.config.fromAddress,
      },
      metadata: {
        dateSent: new Date(raw.createdAt),
        edited: false,
      },
      attachments: [],
    });
  }
}
