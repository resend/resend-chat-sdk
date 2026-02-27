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
      const rootMessageId = this.findRootMessageId(inReplyTo, references);
      if (rootMessageId) {
        const existingThread = this.messageToThread.get(rootMessageId);
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

  private findRootMessageId(
    inReplyTo: string | undefined,
    references: string | undefined
  ): string | undefined {
    if (references) {
      const refs = references.trim().split(WHITESPACE_RE);
      if (refs.length > 0) {
        return refs[0];
      }
    }
    return inReplyTo;
  }
}
