import { randomUUID } from "node:crypto";
import type {
  Adapter,
  AdapterPostableMessage,
  FetchOptions,
  FetchResult,
  StateAdapter,
  StreamChunk,
  StreamOptions,
  WebhookOptions,
} from "chat";
import { Message, parseMarkdown } from "chat";
import type { Root } from "mdast";
import { type InboxSelector, Resend } from "resend";
import type { CardNode } from "./card-renderer.js";
import { ResendFormatConverter } from "./format-converter.js";
import { parseInboundEmail, parseInboxEmail } from "./message-parser.js";
import { renderMessage } from "./message-renderer.js";
import type { NewInboxThread } from "./thread-resolver.js";
import { ThreadResolver } from "./thread-resolver.js";
import type {
  ResendAdapterConfig,
  ResendApiKey,
  ResendInboxDraftSentPayload,
  ResendInboxEmail,
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

/** Default number of messages that fetchMessages() returns. */
const DEFAULT_FETCH_LIMIT = 50;
/** Largest page size that the inbox API accepts. */
const MAX_PAGE_SIZE = 100;

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
  private resendApiKey: string | null = null;
  private chat: ChatInstance | null = null;
  private readonly threadResolver = new ThreadResolver();
  private readonly formatConverter = new ResendFormatConverter();
  private webhookHandler: WebhookHandler | null = null;

  constructor(config: ResendAdapterConfig) {
    if (config.inboxId && config.inboxEmailAddress) {
      throw new Error("Set inboxId or inboxEmailAddress, not both.");
    }
    if (
      config.startInboxThreads &&
      !(config.inboxId || config.inboxEmailAddress)
    ) {
      throw new Error(
        "startInboxThreads requires inboxId or inboxEmailAddress."
      );
    }
    this.config = config;
    this.userName = config.fromAddress;
  }

  private getApiKey(): ResendApiKey {
    const apiKey = this.config.apiKey || process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Resend API key is required. Provide it via config.apiKey or RESEND_API_KEY env var."
      );
    }
    return apiKey;
  }

  /**
   * Lazily create the Resend client so both initialize() and direct usage work.
   * A function `apiKey` is called on each use, and the client is created again
   * when the key changes.
   */
  private async getResend(): Promise<Resend> {
    const source = this.getApiKey();
    const apiKey = typeof source === "function" ? await source() : source;
    if (!apiKey) {
      throw new Error("config.apiKey returned an empty Resend API key.");
    }
    if (!this.resend || this.resendApiKey !== apiKey) {
      this.resend = new Resend(apiKey);
      this.resendApiKey = apiKey;
    }
    return this.resend;
  }

  initialize(chat: ChatInstance): Promise<void> {
    this.getApiKey();
    this.chat = chat;
    this.threadResolver.state = chat.getState?.() ?? null;

    const webhookSecret =
      this.config.webhookSecret || process.env.RESEND_WEBHOOK_SECRET || "";
    this.webhookHandler = new WebhookHandler(
      () => this.getResend(),
      webhookSecret,
      this.inboxSelector(),
      this.config.webhookVerifier
    );
    return Promise.resolve();
  }

  private inboxSelector(): InboxSelector | undefined {
    if (this.config.inboxEmailAddress) {
      return { emailAddress: this.config.inboxEmailAddress };
    }
    if (this.config.inboxId) {
      return { inboxId: this.config.inboxId };
    }
    return undefined;
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
    if (!(webhookSecret || this.config.webhookVerifier)) {
      throw new Error(
        "Webhook secret is required for webhook verification (config.webhookSecret or RESEND_WEBHOOK_SECRET env), unless config.webhookVerifier is set"
      );
    }

    const result = await this.webhookHandler.parseWebhookRequest(request);
    if (!result.event) {
      return new Response(null, { status: result.status });
    }

    if (result.event.type === "inbox.draft.sent") {
      await this.handleInboxDraftSent(result.event);
    } else if (result.event.type === "inbox.email.received") {
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

    // A thread that openDM() opened keeps the chat thread ID of openDM().
    const threadId =
      (await this.threadResolver.getChatThreadId(thread.threadId)) ??
      this.threadResolver.encodeThreadId(thread);
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

  /** Link the Resend thread of the first email that openDM() sent. */
  private async handleInboxDraftSent(
    event: ResendInboxDraftSentPayload
  ): Promise<void> {
    await this.threadResolver.linkInboxDraft(
      event.data.draft_id,
      event.data.thread_id
    );
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
    const resend = await this.getResend();

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
    chatThread: ResendInboxThreadId,
    rendered: { html: string; text: string }
  ): Promise<{ id: string; raw: ResendRawMessage; threadId: string }> {
    const newThread = await this.threadResolver.getNewInboxThread(threadId);
    if (newThread && !newThread.resendThreadId) {
      return this.startInboxThread(
        threadId,
        chatThread.inboxId,
        newThread,
        rendered
      );
    }
    const thread = newThread?.resendThreadId
      ? { inboxId: chatThread.inboxId, threadId: newThread.resendThreadId }
      : chatThread;

    const resend = await this.getResend();
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

  /**
   * Send the first email of a thread that openDM() opened, as a standalone
   * draft. Resend creates the thread when it sends the draft, and the
   * inbox.draft.sent event links the thread to the chat thread.
   */
  private async startInboxThread(
    threadId: string,
    inboxId: string,
    newThread: NewInboxThread,
    rendered: { html: string; text: string }
  ): Promise<{ id: string; raw: ResendRawMessage; threadId: string }> {
    if (newThread.draftId) {
      throw new Error(
        `Inbox thread ${threadId} is not ready. Resend creates the thread when it sends the first email, and the adapter gets its ID from the inbox.draft.sent event. Subscribe your webhook to inbox.draft.sent.`
      );
    }

    const resend = await this.getResend();
    const subject =
      (await this.threadResolver.getSubject(threadId)) ?? "New message";
    const draft = await resend.inboxes.drafts.create({
      inboxId,
      to: [newThread.toAddress],
      subject,
      html: rendered.html,
      text: rendered.text,
    });
    if (draft.error || !draft.data) {
      throw new Error(
        `Failed to create inbox draft: ${draft.error?.message || "Unknown error"}`
      );
    }

    // Track the draft before it is sent, so that the inbox.draft.sent event finds it.
    await this.threadResolver.trackInboxDraft(draft.data.id, threadId);
    const sent = await resend.inboxes.drafts.send({
      inboxId,
      draftId: draft.data.id,
    });
    if (sent.error || !sent.data) {
      throw new Error(
        `Failed to send inbox draft: ${sent.error?.message || "Unknown error"}`
      );
    }
    await this.threadResolver.markNewInboxThreadSent(threadId, draft.data.id);
    await this.threadResolver.trackSubject(threadId, subject);

    return {
      id: sent.data.id,
      raw: {
        id: sent.data.id,
        inboxId,
        messageId: "",
        from: this.config.fromAddress,
        to: [newThread.toAddress],
        subject,
        text: rendered.text,
        html: rendered.html,
        createdAt: new Date().toISOString(),
      },
      threadId,
    };
  }

  /**
   * Get the Resend thread of an inbox chat thread. Returns `null` for a thread
   * that openDM() opened, until the inbox.draft.sent event links it.
   */
  private async getResendInboxThread(
    threadId: string,
    chatThread: ResendInboxThreadId
  ): Promise<ResendInboxThreadId | null> {
    const newThread = await this.threadResolver.getNewInboxThread(threadId);
    if (!newThread) {
      return chatThread;
    }
    return newThread.resendThreadId
      ? { inboxId: chatThread.inboxId, threadId: newThread.resendThreadId }
      : null;
  }

  private async findLatestInboxEmail(
    thread: ResendInboxThreadId
  ): Promise<string> {
    const emails = await this.listAllInboxThreadEmails(thread);
    const latestInbound = emails
      .filter((email) => email.direction === "inbound")
      .at(-1);
    const emailId = (latestInbound ?? emails.at(-1))?.id;
    if (!emailId) {
      throw new Error(
        `Inbox thread ${thread.threadId} has no email to reply to`
      );
    }
    return emailId;
  }

  /** List one page of the emails of an inbox thread, oldest first. */
  private async listInboxThreadEmails(
    thread: ResendInboxThreadId,
    page: { limit: number; after?: string; before?: string }
  ): Promise<{ emails: ResendInboxEmail[]; hasMore: boolean }> {
    const resend = await this.getResend();
    const response = await resend.inboxes.threads.emails.list({
      inboxId: thread.inboxId,
      threadId: thread.threadId,
      limit: page.limit,
      ...(page.before
        ? { before: page.before }
        : page.after && { after: page.after }),
    });
    if (response.error || !response.data) {
      throw new Error(
        `Failed to list inbox thread emails: ${response.error?.message || "Unknown error"}`
      );
    }
    return { emails: response.data.data, hasMore: response.data.has_more };
  }

  /** List every email of an inbox thread, oldest first. */
  private async listAllInboxThreadEmails(
    thread: ResendInboxThreadId
  ): Promise<ResendInboxEmail[]> {
    const emails: ResendInboxEmail[] = [];
    let after: string | undefined;
    for (;;) {
      const page = await this.listInboxThreadEmails(thread, {
        limit: MAX_PAGE_SIZE,
        after,
      });
      emails.push(...page.emails);
      after = page.emails.at(-1)?.id;
      if (!(page.hasMore && after)) {
        return emails;
      }
    }
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

  /**
   * Open a thread with an email address. With `startInboxThreads`, the first
   * post starts a new inbox thread. Otherwise, posts are sent with
   * `resend.emails.send()`.
   */
  async openDM(email: string): Promise<string> {
    const inbox = this.inboxSelector();
    if (inbox && this.config.startInboxThreads) {
      const inboxId =
        inbox.inboxId ?? (await this.getWebhookHandler().getInboxId(inbox));
      // A placeholder until Resend creates the thread. See startInboxThread().
      const threadId = this.threadResolver.encodeThreadId({
        inboxId,
        threadId: randomUUID(),
      });
      await this.threadResolver.trackNewInboxThread(threadId, email);
      return threadId;
    }

    const messageId = generateMessageId(email);
    const hash = hashMessageId(messageId);
    const threadId = this.threadResolver.encodeThreadId({
      toAddress: email,
      rootMessageIdHash: hash,
    });
    await this.threadResolver.trackMessage(threadId, messageId);
    return threadId;
  }

  async fetchThread(threadId: string): Promise<{
    id: string;
    channelId: string;
    metadata: Record<string, unknown>;
  }> {
    const decoded = this.threadResolver.decodeThreadId(threadId);
    if ("inboxId" in decoded) {
      const thread = await this.getResendInboxThread(threadId, decoded);
      if (!thread) {
        const newThread = await this.threadResolver.getNewInboxThread(threadId);
        return {
          id: threadId,
          channelId: this.channelIdFromThreadId(threadId),
          metadata: {
            title: `New inbox thread with ${newThread?.toAddress}`,
            inboxId: decoded.inboxId,
          },
        };
      }
      return {
        id: threadId,
        channelId: this.channelIdFromThreadId(threadId),
        metadata: {
          title: `Inbox thread ${thread.threadId}`,
          inboxId: thread.inboxId,
          inboxThreadId: thread.threadId,
        },
      };
    }
    return {
      id: threadId,
      channelId: this.channelIdFromThreadId(threadId),
      metadata: {
        title: `Conversation with ${decoded.toAddress}`,
        toAddress: decoded.toAddress,
      },
    };
  }

  /**
   * Fetch the emails of an inbox thread. Returns no messages for a thread
   * without an inbox, because the Receiving API keeps no thread history.
   */
  async fetchMessages(
    threadId: string,
    options: FetchOptions = {}
  ): Promise<FetchResult<ResendRawMessage>> {
    const decoded = this.decodeThreadId(threadId);
    const thread =
      "inboxId" in decoded
        ? await this.getResendInboxThread(threadId, decoded)
        : null;
    if (!thread) {
      return { messages: [] };
    }

    const limit = Math.min(
      Math.max(options.limit ?? DEFAULT_FETCH_LIMIT, 1),
      MAX_PAGE_SIZE
    );
    const { emails, nextCursor } =
      options.direction === "forward"
        ? await this.fetchInboxEmailsForward(thread, limit, options.cursor)
        : await this.fetchInboxEmailsBackward(thread, limit, options.cursor);

    return {
      messages: emails.map((email) =>
        parseInboxEmail(email, thread, threadId, this.config.fromAddress)
      ),
      ...(nextCursor && { nextCursor }),
    };
  }

  /** Fetch one email of an inbox thread, or `null` when it does not exist. */
  async fetchMessage(
    threadId: string,
    messageId: string
  ): Promise<Message<ResendRawMessage> | null> {
    const decoded = this.decodeThreadId(threadId);
    const thread =
      "inboxId" in decoded
        ? await this.getResendInboxThread(threadId, decoded)
        : null;
    if (!thread) {
      return null;
    }

    const resend = await this.getResend();
    const response = await resend.inboxes.threads.emails.get({
      inboxId: thread.inboxId,
      threadId: thread.threadId,
      emailId: messageId,
    });
    if (response.error?.statusCode === 404) {
      return null;
    }
    if (response.error || !response.data) {
      throw new Error(
        `Failed to fetch inbox email: ${response.error?.message || "Unknown error"}`
      );
    }
    return parseInboxEmail(
      response.data,
      thread,
      threadId,
      this.config.fromAddress
    );
  }

  /** The cursor is the ID of the last email of the previous page. */
  private async fetchInboxEmailsForward(
    thread: ResendInboxThreadId,
    limit: number,
    cursor: string | undefined
  ): Promise<{ emails: ResendInboxEmail[]; nextCursor?: string }> {
    const page = await this.listInboxThreadEmails(thread, {
      limit,
      after: cursor,
    });
    return {
      emails: page.emails,
      nextCursor: page.hasMore ? page.emails.at(-1)?.id : undefined,
    };
  }

  /**
   * The cursor is the ID of the first email of the previous page. The inbox API
   * lists the oldest emails first, so the first page lists the whole thread and
   * keeps the newest emails.
   */
  private async fetchInboxEmailsBackward(
    thread: ResendInboxThreadId,
    limit: number,
    cursor: string | undefined
  ): Promise<{ emails: ResendInboxEmail[]; nextCursor?: string }> {
    if (cursor) {
      const page = await this.listInboxThreadEmails(thread, {
        limit,
        before: cursor,
      });
      return {
        emails: page.emails,
        nextCursor: page.hasMore ? page.emails[0]?.id : undefined,
      };
    }

    const all = await this.listAllInboxThreadEmails(thread);
    const emails = all.slice(-limit);
    return {
      emails,
      nextCursor: all.length > limit ? emails[0]?.id : undefined,
    };
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
