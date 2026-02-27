import type { ResendThreadId } from "./types.js";
import { hashMessageId } from "./utils.js";

const WHITESPACE_RE = /\s+/;

interface ResolveInput {
  inReplyTo: string | undefined;
  messageId: string;
  references: string | undefined;
  toAddress: string;
}

export class ThreadResolver {
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
        const existingThread = this.messageToThread.get(candidate);
        if (existingThread) {
          this.trackMessage(existingThread, messageId);
          return existingThread;
        }
      }
    }

    const hash = await hashMessageId(messageId);
    const threadId = this.encodeThreadId({
      toAddress,
      rootMessageIdHash: hash,
    });
    this.trackMessage(threadId, messageId);
    return threadId;
  }

  trackMessage(threadId: string, messageId: string): void {
    this.messageToThread.set(messageId, threadId);
    const messages = this.threadMessages.get(threadId) || [];
    if (!messages.includes(messageId)) {
      messages.push(messageId);
    }
    this.threadMessages.set(threadId, messages);
  }

  getLastMessageId(threadId: string): string | undefined {
    const messages = this.threadMessages.get(threadId);
    if (!messages || messages.length === 0) {
      return undefined;
    }
    return messages.at(-1);
  }

  getReplyHeaders(threadId: string): Record<string, string> | undefined {
    const lastMessageId = this.getLastMessageId(threadId);
    if (!lastMessageId) {
      return undefined;
    }

    const messages = this.threadMessages.get(threadId) || [];
    return {
      "In-Reply-To": lastMessageId,
      References: messages.join(" "),
    };
  }

  trackSubject(threadId: string, subject: string): void {
    if (!this.threadSubjects.has(threadId)) {
      this.threadSubjects.set(threadId, subject);
    }
  }

  getSubject(threadId: string): string | undefined {
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
