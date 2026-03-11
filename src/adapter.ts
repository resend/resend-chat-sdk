import type { AdapterPostableMessage } from "chat";
import { Message, parseMarkdown } from "chat";
import type { Root } from "mdast";
import { Resend } from "resend";
import type { CardNode } from "./card-renderer.js";
import { ResendFormatConverter } from "./format-converter.js";
import { parseInboundEmail } from "./message-parser.js";
import { renderMessage } from "./message-renderer.js";
import { ThreadResolver } from "./thread-resolver.js";
import type {
  ResendAdapterConfig,
  ResendRawMessage,
  ResendThreadId,
} from "./types.js";
import {
  generateMessageId,
  hashMessageId,
  parseEmailAddress,
} from "./utils.js";
import { WebhookHandler } from "./webhook-handler.js";

export interface ChatInstance {
  processMessage(adapter: unknown, threadId: string, message: unknown): void;
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

  private readonly config: ResendAdapterConfig;
  private resend: Resend | null = null;
  private chat: ChatInstance | null = null;
  private readonly threadResolver = new ThreadResolver();
  private readonly formatConverter = new ResendFormatConverter();
  private webhookHandler: WebhookHandler | null = null;

  constructor(config: ResendAdapterConfig) {
    this.config = config;
    this.userName = config.fromAddress;
  }

  /** Lazily create the Resend client so both initialize() and direct usage work. */
  private getResend(): Resend {
    if (!this.resend) {
      const apiKey = this.config.apiKey || process.env.RESEND_API_KEY;
      if (!apiKey) {
        throw new Error(
          "Resend API key is required. Provide it via config.apiKey or RESEND_API_KEY env var."
        );
      }
      this.resend = new Resend(apiKey);
    }
    return this.resend;
  }

  initialize(chat: ChatInstance): Promise<void> {
    try {
      this.getResend();
      this.chat = chat;

      const webhookSecret =
        this.config.webhookSecret || process.env.RESEND_WEBHOOK_SECRET || "";
      this.webhookHandler = new WebhookHandler(this.getResend(), webhookSecret);

      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  encodeThreadId(id: ResendThreadId): string {
    return this.threadResolver.encodeThreadId(id);
  }

  decodeThreadId(threadId: string): ResendThreadId {
    return this.threadResolver.decodeThreadId(threadId);
  }

  channelIdFromThreadId(threadId: string): string {
    const { toAddress } = this.decodeThreadId(threadId);
    return `resend:${toAddress}`;
  }

  async handleWebhook(request: Request): Promise<Response> {
    if (!(this.webhookHandler && this.chat)) {
      throw new Error("Adapter not initialized. Call initialize() first.");
    }

    const webhookSecret =
      this.config.webhookSecret || process.env.RESEND_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error(
        "Webhook secret is required for webhook verification (config.webhookSecret or RESEND_WEBHOOK_SECRET env)"
      );
    }

    const result = await this.webhookHandler.parseWebhookRequest(request);
    if (!result.event) {
      return new Response(null, { status: result.status });
    }

    const email = await this.webhookHandler.fetchEmailContent(
      result.event.data.email_id
    );

    // Webhook payload is the authoritative source for attachments —
    // the fetched email may not include them.
    if (result.event.data.attachments?.length && !email.attachments?.length) {
      email.attachments = result.event.data.attachments;
    }

    const senderAddress = parseEmailAddress(email.from);

    // Normalize header keys to handle Resend's varying casing
    const headers = email.headers || {};
    const inReplyTo =
      headers["In-Reply-To"] || headers["in-reply-to"] || undefined;
    const references = headers.References || headers.references || undefined;

    const threadId = await this.threadResolver.resolveThreadId({
      toAddress: senderAddress,
      messageId: email.message_id,
      inReplyTo,
      references,
    });

    this.threadResolver.trackSubject(threadId, email.subject);

    const parsed = parseInboundEmail(email, threadId, this.config.fromAddress);
    await this.chat.processMessage(this, threadId, parsed);

    return new Response(null, { status: 200 });
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<{ id: string; raw: ResendRawMessage; threadId: string }> {
    const resend = this.getResend();

    // Normalize AdapterPostableMessage to { text?, formatted?, card? }
    let normalized: { text?: string; formatted?: Root; card?: CardNode };
    if (typeof message === "string") {
      normalized = { text: message };
    } else if ("markdown" in message) {
      normalized = {
        text: (message as { markdown: string }).markdown,
      };
    } else if ("raw" in message) {
      normalized = { text: (message as { raw: string }).raw };
    } else if ("ast" in message) {
      normalized = {
        formatted: (message as { ast: Root }).ast,
      };
    } else if ("card" in message) {
      normalized = {
        card: (message as { card: CardNode }).card,
      };
    } else if ("type" in message) {
      normalized = { card: message as CardNode };
    } else {
      normalized = message as {
        text?: string;
        formatted?: Root;
        card?: CardNode;
      };
    }

    const decoded = this.threadResolver.decodeThreadId(threadId);
    const rendered = await renderMessage(normalized);

    const fromHeader = this.config.fromName
      ? `${this.config.fromName} <${this.config.fromAddress}>`
      : this.config.fromAddress;

    const messageId = generateMessageId(this.config.fromAddress);
    const headers = this.threadResolver.getReplyHeaders(threadId);

    const storedSubject = this.threadResolver.getSubject(threadId);
    const subject = storedSubject ? `Re: ${storedSubject}` : "New message";

    const response = await resend.emails.send({
      from: fromHeader,
      to: [decoded.toAddress],
      subject,
      html: rendered.html,
      text: rendered.text,
      ...(headers && { headers }),
    });

    if (response.error || !response.data) {
      throw new Error(
        `Failed to send email: ${response.error?.message || "Unknown error"}`
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

  editMessage(_threadId: string, _messageId: string, _message: unknown): never {
    throw new NotImplementedError("editMessage");
  }

  deleteMessage(_threadId: string, _messageId: string): never {
    throw new NotImplementedError("deleteMessage");
  }

  addReaction(_threadId: string, _messageId: string, _reaction: string): never {
    throw new NotImplementedError("addReaction");
  }

  removeReaction(
    _threadId: string,
    _messageId: string,
    _reaction: string
  ): never {
    throw new NotImplementedError("removeReaction");
  }

  startTyping(_threadId: string): never {
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

  fetchThread(threadId: string): Promise<{
    id: string;
    channelId: string;
    metadata: Record<string, unknown>;
  }> {
    try {
      const decoded = this.threadResolver.decodeThreadId(threadId);
      return Promise.resolve({
        id: threadId,
        channelId: this.channelIdFromThreadId(threadId),
        metadata: {
          title: `Conversation with ${decoded.toAddress}`,
          toAddress: decoded.toAddress,
        },
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  fetchMessages(_threadId: string): Promise<{
    messages: Message<ResendRawMessage>[];
    nextCursor?: string;
  }> {
    return Promise.resolve({ messages: [] });
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
