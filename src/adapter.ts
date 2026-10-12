import type {
  Adapter,
  AdapterPostableMessage,
  StateAdapter,
  StreamChunk,
  StreamOptions,
  WebhookOptions,
} from "chat";
import { Message, parseMarkdown } from "chat";
import type { Root } from "mdast";
import { Resend } from "resend";
import type { CardNode } from "./card-renderer.js";
import { ResendFormatConverter } from "./format-converter.js";
import { parseInboundEmail, parseInboxEmail } from "./message-parser.js";
import { renderMessage } from "./message-renderer.js";
import { ThreadResolver } from "./thread-resolver.js";
import type {
  ResendAdapterConfig,
  ResendInboxThreadId,
  ResendInboxWebhookPayload,
  ResendRawMessage,
  ResendThreadId,
  ResendWebhookPayload,
} from "./types.js";
import {
  generateMessageId,
  hashMessageId,
  parseEmailAddress,
} from "./utils.js";
import { WebhookHandler } from "./webhook-handler.js";

export interface ChatInstance {
  getState?(): StateAdapter;
  processMessage(
    adapter: unknown,
    threadId: string,
    message: unknown,
    options?: WebhookOptions
  ): void;
}

class NotImplementedError extends Error {
  constructor(method: string) {
    super(`${method} is not supported by the Resend adapter`);
    this.name = "NotImplementedError";
  }
}

export class ResendAdapter
  implements Adapter<ResendThreadId | ResendInboxThreadId, ResendRawMessage>
{
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
    this.getResend();
    this.chat = chat;
    this.threadResolver.state = chat.getState?.() ?? null;

    const webhookSecret =
      this.config.webhookSecret || process.env.RESEND_WEBHOOK_SECRET || "";
    this.webhookHandler = new WebhookHandler(
      this.getResend(),
      webhookSecret,
      this.config.inboxId
    );
    return Promise.resolve();
  }

  encodeThreadId(id: ResendThreadId | ResendInboxThreadId): string {
    return this.threadResolver.encodeThreadId(id);
  }

  decodeThreadId(threadId: string): ResendThreadId | ResendInboxThreadId {
    return this.threadResolver.decodeThreadId(threadId);
  }

  channelIdFromThreadId(threadId: string): string {
    const decoded = this.decodeThreadId(threadId);
    if ("inboxId" in decoded) {
      return `resend:${decoded.inboxId}`;
    }
    return `resend:${decoded.toAddress}`;
  }

  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
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

    if (result.event.type === "inbox.email.received") {
      await this.handleInboxEmail(result.event, options);
    } else {
      await this.handleReceivedEmail(result.event, options);
    }

    return new Response(null, { status: 200 });
  }

  private async handleInboxEmail(
    event: ResendInboxWebhookPayload,
    options?: WebhookOptions
  ): Promise<void> {
    const thread = {
      inboxId: event.data.inbox_id,
      threadId: event.data.thread_id,
    };
    const email = await this.getWebhookHandler().fetchInboxEmail({
      ...thread,
      emailId: event.data.email_id,
    });

    const threadId = this.threadResolver.encodeThreadId(thread);
    await this.threadResolver.trackInboxEmail(threadId, email.id);
    if (email.subject) {
      await this.threadResolver.trackSubject(threadId, email.subject);
    }

    const parsed = parseInboxEmail(
      email,
      thread,
      threadId,
      this.config.fromAddress
    );
    this.getChat().processMessage(this, threadId, parsed, options);
  }

  private async handleReceivedEmail(
    event: ResendWebhookPayload,
    options?: WebhookOptions
  ): Promise<void> {
    const email = await this.getWebhookHandler().fetchEmailContent(
      event.data.email_id
    );

    // Webhook payload is the authoritative source for attachments —
    // the fetched email may not include them.
    if (event.data.attachments?.length && !email.attachments?.length) {
      email.attachments = event.data.attachments;
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

    await this.threadResolver.trackSubject(threadId, email.subject);

    const parsed = parseInboundEmail(email, threadId, this.config.fromAddress);
    this.getChat().processMessage(this, threadId, parsed, options);
  }

  private getWebhookHandler(): WebhookHandler {
    if (!this.webhookHandler) {
      throw new Error("Adapter not initialized. Call initialize() first.");
    }
    return this.webhookHandler;
  }

  private getChat(): ChatInstance {
    if (!this.chat) {
      throw new Error("Adapter not initialized. Call initialize() first.");
    }
    return this.chat;
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
        formatted: parseMarkdown((message as { markdown: string }).markdown),
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

    if ("inboxId" in decoded) {
      return this.replyInInboxThread(threadId, decoded, rendered);
    }

    const fromHeader = this.config.fromName
      ? `${this.config.fromName} <${this.config.fromAddress}>`
      : this.config.fromAddress;

    const messageId = generateMessageId(this.config.fromAddress);
    const headers = await this.threadResolver.getReplyHeaders(threadId);

    const storedSubject = await this.threadResolver.getSubject(threadId);
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

    await this.threadResolver.trackMessage(threadId, messageId);

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

  private async replyInInboxThread(
    threadId: string,
    thread: ResendInboxThreadId,
    rendered: { html: string; text: string }
  ): Promise<{ id: string; raw: ResendRawMessage; threadId: string }> {
    const resend = this.getResend();
    const emailId =
      (await this.threadResolver.getInboxEmail(threadId)) ??
      (await this.findLatestInboxEmail(thread));

    const response = await resend.inboxes.threads.emails.reply({
      inboxId: thread.inboxId,
      threadId: thread.threadId,
      emailId,
      html: rendered.html,
      text: rendered.text,
    });

    if (response.error || !response.data) {
      throw new Error(
        `Failed to reply in inbox thread: ${response.error?.message || "Unknown error"}`
      );
    }

    const storedSubject = await this.threadResolver.getSubject(threadId);

    return {
      id: response.data.id,
      raw: {
        id: response.data.id,
        inboxId: thread.inboxId,
        inboxThreadId: thread.threadId,
        messageId: "",
        from: this.config.fromAddress,
        to: [],
        subject: replySubject(storedSubject),
        text: rendered.text,
        html: rendered.html,
        createdAt: new Date().toISOString(),
      },
      threadId,
    };
  }

  private async findLatestInboxEmail(
    thread: ResendInboxThreadId
  ): Promise<string> {
    const resend = this.getResend();
    let after: string | undefined;
    let latestInbound: string | undefined;
    let latest: string | undefined;

    for (;;) {
      const response = await resend.inboxes.threads.emails.list({
        inboxId: thread.inboxId,
        threadId: thread.threadId,
        limit: 100,
        ...(after && { after }),
      });
      if (response.error || !response.data) {
        throw new Error(
          `Failed to list inbox thread emails: ${response.error?.message || "Unknown error"}`
        );
      }
      for (const email of response.data.data) {
        latest = email.id;
        if (email.direction === "inbound") {
          latestInbound = email.id;
        }
      }
      if (!(response.data.has_more && latest)) {
        break;
      }
      after = latest;
    }

    const emailId = latestInbound ?? latest;
    if (!emailId) {
      throw new Error(
        `Inbox thread ${thread.threadId} has no email to reply to`
      );
    }
    return emailId;
  }

  async stream(
    threadId: string,
    textStream: AsyncIterable<string | StreamChunk>,
    _options?: StreamOptions
  ): Promise<{ id: string; raw: ResendRawMessage; threadId: string }> {
    let markdown = "";

    for await (const chunk of textStream) {
      if (typeof chunk === "string") {
        markdown += chunk;
        continue;
      }

      if (chunk.type === "markdown_text") {
        markdown += chunk.text;
      }
    }

    if (!markdown) {
      throw new Error(
        "Resend adapter received a stream with no textual content (no string or markdown_text chunks). Email requires text; ensure your stream produces at least one text delta, or handle empty completions before calling thread.post()."
      );
    }

    return this.postMessage(threadId, { markdown });
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
    const hash = hashMessageId(messageId);
    const threadId = this.threadResolver.encodeThreadId({
      toAddress: email,
      rootMessageIdHash: hash,
    });
    await this.threadResolver.trackMessage(threadId, messageId);
    return threadId;
  }

  fetchThread(threadId: string): Promise<{
    id: string;
    channelId: string;
    metadata: Record<string, unknown>;
  }> {
    const decoded = this.threadResolver.decodeThreadId(threadId);
    if ("inboxId" in decoded) {
      return Promise.resolve({
        id: threadId,
        channelId: this.channelIdFromThreadId(threadId),
        metadata: {
          title: `Inbox thread ${decoded.threadId}`,
          inboxId: decoded.inboxId,
          inboxThreadId: decoded.threadId,
        },
      });
    }
    return Promise.resolve({
      id: threadId,
      channelId: this.channelIdFromThreadId(threadId),
      metadata: {
        title: `Conversation with ${decoded.toAddress}`,
        toAddress: decoded.toAddress,
      },
    });
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

const REPLY_PREFIX_RE = /^re:/i;

function replySubject(subject: string | undefined): string {
  if (!subject) {
    return "";
  }
  return REPLY_PREFIX_RE.test(subject) ? subject : `Re: ${subject}`;
}
