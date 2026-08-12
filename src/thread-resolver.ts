import type { StateAdapter } from "chat";
import type { ResendThreadId } from "./types.js";
import { hashMessageId } from "./utils.js";

const WHITESPACE_RE = /\s+/;
const STATE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TRACKED_MESSAGES = 100;

interface ResolveInput {
  inReplyTo: string | undefined;
  messageId: string;
  references: string | undefined;
  toAddress: string;
}

export class ThreadResolver {
  state: StateAdapter | null = null;

  private readonly messageToThread = new Map<string, string>();
  private readonly threadMessages = new Map<string, string[]>();
  private readonly threadSubjects = new Map<string, string>();

  encodeThreadId(id: ResendThreadId): string {
    return `resend:${id.toAddress}:${id.rootMessageIdHash}`;
  }

  decodeThreadId(threadId: string): ResendThreadId {
    const parts = threadId.split(":");
    if (parts.length !== 3 || parts[0] !== "resend" || !parts[1] || !parts[2]) {
      throw new Error(`Invalid thread ID format: ${threadId}`);
    }
    return {
      toAddress: parts[1],
      rootMessageIdHash: parts[2],
    };
  }

  async resolveThreadId(input: ResolveInput): Promise<string> {
    const { toAddress, messageId, inReplyTo, references } = input;

    if (inReplyTo || references) {
      const candidateIds = this.extractMessageIds(inReplyTo, references);
      for (const candidate of candidateIds) {
        const existingThread = this.state
          ? await this.state.get<string>(`resend:msg-thread:${candidate}`)
          : this.messageToThread.get(candidate);
        if (existingThread) {
          await this.trackMessage(existingThread, messageId);
          return existingThread;
        }
      }
    }

    const hash = hashMessageId(messageId);
    const threadId = this.encodeThreadId({
      toAddress,
      rootMessageIdHash: hash,
    });
    await this.trackMessage(threadId, messageId);
    return threadId;
  }

  async trackMessage(threadId: string, messageId: string): Promise<void> {
    if (this.state) {
      const key = `resend:thread-messages:${threadId}`;
      const messages = await this.state.getList<string>(key);
      if (!messages.includes(messageId)) {
        await this.state.appendToList(key, messageId, {
          maxLength: MAX_TRACKED_MESSAGES,
          ttlMs: STATE_TTL_MS,
        });
      }
      await this.state.set(
        `resend:msg-thread:${messageId}`,
        threadId,
        STATE_TTL_MS
      );
      return;
    }

    this.messageToThread.set(messageId, threadId);
    const messages = this.threadMessages.get(threadId) || [];
    if (!messages.includes(messageId)) {
      messages.push(messageId);
    }
    this.threadMessages.set(threadId, messages);
  }

  async getReplyHeaders(
    threadId: string
  ): Promise<Record<string, string> | undefined> {
    const messages = this.state
      ? await this.state.getList<string>(`resend:thread-messages:${threadId}`)
      : this.threadMessages.get(threadId) || [];
    const lastMessageId = messages.at(-1);
    if (!lastMessageId) {
      return undefined;
    }

    return {
      "In-Reply-To": lastMessageId,
      References: messages.join(" "),
    };
  }

  async trackSubject(threadId: string, subject: string): Promise<void> {
    if (this.state) {
      await this.state.setIfNotExists(
        `resend:thread-subject:${threadId}`,
        subject,
        STATE_TTL_MS
      );
      return;
    }

    if (!this.threadSubjects.has(threadId)) {
      this.threadSubjects.set(threadId, subject);
    }
  }

  async getSubject(threadId: string): Promise<string | undefined> {
    if (this.state) {
      const subject = await this.state.get<string>(
        `resend:thread-subject:${threadId}`
      );
      return subject ?? undefined;
    }
    return this.threadSubjects.get(threadId);
  }

  /**
   * Extract all candidate message IDs from In-Reply-To and References headers.
   * Handles both RFC 2822 whitespace-separated format and Resend's
   * JSON-encoded array format (e.g. `["<id1>","<id2>"]`).
   */
  private extractMessageIds(
    inReplyTo: string | undefined,
    references: string | undefined
  ): string[] {
    const ids: string[] = [];

    if (references) {
      const trimmed = references.trim();
      if (trimmed.startsWith("[")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            ids.push(...parsed.map((s: string) => s.trim()).filter(Boolean));
          }
        } catch {
          // Fall back to whitespace splitting if JSON parse fails
          ids.push(...trimmed.split(WHITESPACE_RE).filter(Boolean));
        }
      } else {
        ids.push(...trimmed.split(WHITESPACE_RE).filter(Boolean));
      }
    }

    if (inReplyTo) {
      const trimmed = inReplyTo.trim();
      if (trimmed && !ids.includes(trimmed)) {
        ids.push(trimmed);
      }
    }

    return ids;
  }
}
