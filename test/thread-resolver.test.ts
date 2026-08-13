import { describe, expect, it } from "vitest";
import { ThreadResolver } from "../src/thread-resolver.js";
import type { ResendThreadId } from "../src/types.js";

const THREAD_ID_PATTERN = /^resend:bot@example\.com:[0-9a-f]{16}$/;

describe("ThreadResolver", () => {
  const resolver = new ThreadResolver();

  describe("encodeThreadId", () => {
    it("encodes to resend:{to}:{hash} format", () => {
      const id: ResendThreadId = {
        toAddress: "bot@example.com",
        rootMessageIdHash: "a1b2c3d4e5f6a7b8",
      };
      expect(resolver.encodeThreadId(id)).toBe(
        "resend:bot@example.com:a1b2c3d4e5f6a7b8"
      );
    });
  });

  describe("decodeThreadId", () => {
    it("decodes resend:{to}:{hash} format", () => {
      const decoded = resolver.decodeThreadId(
        "resend:bot@example.com:a1b2c3d4e5f6a7b8"
      );
      expect(decoded).toEqual({
        toAddress: "bot@example.com",
        rootMessageIdHash: "a1b2c3d4e5f6a7b8",
      });
    });

    it("throws on invalid format", () => {
      expect(() => resolver.decodeThreadId("invalid")).toThrow();
      expect(() => resolver.decodeThreadId("resend:missing")).toThrow();
    });
  });

  describe("resolveThreadId", () => {
    it("creates new thread ID for email without In-Reply-To", async () => {
      const resolver = new ThreadResolver();
      const threadId = await resolver.resolveThreadId({
        toAddress: "bot@example.com",
        messageId: "<msg1@mail.resend.dev>",
        inReplyTo: undefined,
        references: undefined,
      });
      expect(threadId).toMatch(THREAD_ID_PATTERN);
    });

    it("resolves to existing thread for reply", async () => {
      const resolver = new ThreadResolver();
      const original = await resolver.resolveThreadId({
        toAddress: "bot@example.com",
        messageId: "<original@mail.resend.dev>",
        inReplyTo: undefined,
        references: undefined,
      });

      const reply = await resolver.resolveThreadId({
        toAddress: "bot@example.com",
        messageId: "<reply@mail.resend.dev>",
        inReplyTo: "<original@mail.resend.dev>",
        references: "<original@mail.resend.dev>",
      });

      expect(reply).toBe(original);
    });

    it("uses first reference as root for deep threads", async () => {
      const resolver = new ThreadResolver();
      const root = await resolver.resolveThreadId({
        toAddress: "bot@example.com",
        messageId: "<root@mail.resend.dev>",
        inReplyTo: undefined,
        references: undefined,
      });

      const deep = await resolver.resolveThreadId({
        toAddress: "bot@example.com",
        messageId: "<deep@mail.resend.dev>",
        inReplyTo: "<mid@mail.resend.dev>",
        references: "<root@mail.resend.dev> <mid@mail.resend.dev>",
      });

      expect(deep).toBe(root);
    });

    it("resolves thread from JSON-encoded references array (Resend format)", async () => {
      const resolver = new ThreadResolver();
      const root = await resolver.resolveThreadId({
        toAddress: "bot@example.com",
        messageId: "<root@mail.resend.dev>",
        inReplyTo: undefined,
        references: undefined,
      });

      const reply = await resolver.resolveThreadId({
        toAddress: "bot@example.com",
        messageId: "<reply@mail.resend.dev>",
        inReplyTo: "<ses-assigned@amazonses.com>",
        references: '["<root@mail.resend.dev>","<ses-assigned@amazonses.com>"]',
      });

      expect(reply).toBe(root);
    });

    it("resolves thread when only in-reply-to matches (SES-assigned ID in references)", async () => {
      const resolver = new ThreadResolver();
      const root = await resolver.resolveThreadId({
        toAddress: "bot@example.com",
        messageId: "<root@mail.resend.dev>",
        inReplyTo: undefined,
        references: undefined,
      });

      // Bot replies, tracking both our messageId and the SES-assigned one
      await resolver.trackMessage(root, "<ses-reply@amazonses.com>");

      const userReply = await resolver.resolveThreadId({
        toAddress: "bot@example.com",
        messageId: "<user-reply@mail.resend.dev>",
        inReplyTo: "<ses-reply@amazonses.com>",
        references: '["<root@mail.resend.dev>"]',
      });

      expect(userReply).toBe(root);
    });

    it("creates new thread when JSON-encoded references contain no tracked IDs", async () => {
      const resolver = new ThreadResolver();
      const threadId = await resolver.resolveThreadId({
        toAddress: "bot@example.com",
        messageId: "<orphan@mail.resend.dev>",
        inReplyTo: "<unknown@amazonses.com>",
        references:
          '["<unknown1@mail.resend.dev>","<unknown2@mail.resend.dev>"]',
      });

      expect(threadId).toMatch(THREAD_ID_PATTERN);
    });

    it("handles malformed JSON references by falling back to whitespace split", async () => {
      const resolver = new ThreadResolver();
      const root = await resolver.resolveThreadId({
        toAddress: "bot@example.com",
        messageId: "<root@mail.resend.dev>",
        inReplyTo: undefined,
        references: undefined,
      });

      const reply = await resolver.resolveThreadId({
        toAddress: "bot@example.com",
        messageId: "<reply@mail.resend.dev>",
        inReplyTo: undefined,
        references: "[invalid json <root@mail.resend.dev>",
      });

      // Falls back to whitespace split, finds "<root@mail.resend.dev>" won't match
      // because "[invalid" and "json" are also tokens — but root IS in the list
      // Actually the split produces: ["[invalid", "json", "<root@mail.resend.dev>"]
      expect(reply).toBe(root);
    });
  });

  describe("getReplyHeaders", () => {
    it("returns In-Reply-To for the last message and References for all", async () => {
      const resolver = new ThreadResolver();
      await resolver.trackMessage(
        "resend:bot@example.com:abc123",
        "<msg1@test.com>"
      );
      await resolver.trackMessage(
        "resend:bot@example.com:abc123",
        "<msg2@test.com>"
      );
      const headers = await resolver.getReplyHeaders(
        "resend:bot@example.com:abc123"
      );
      expect(headers).toEqual({
        "In-Reply-To": "<msg2@test.com>",
        References: "<msg1@test.com> <msg2@test.com>",
      });
    });

    it("returns undefined when no messages tracked", async () => {
      const resolver = new ThreadResolver();
      const headers = await resolver.getReplyHeaders(
        "resend:bot@example.com:unknown"
      );
      expect(headers).toBeUndefined();
    });
  });

  describe("subject tracking", () => {
    it("stores and retrieves subject for thread", async () => {
      const resolver = new ThreadResolver();
      await resolver.trackSubject(
        "resend:bot@example.com:abc123",
        "Hello World"
      );
      expect(await resolver.getSubject("resend:bot@example.com:abc123")).toBe(
        "Hello World"
      );
    });

    it("keeps first subject, ignores subsequent", async () => {
      const resolver = new ThreadResolver();
      await resolver.trackSubject(
        "resend:bot@example.com:abc123",
        "First Subject"
      );
      await resolver.trackSubject(
        "resend:bot@example.com:abc123",
        "Second Subject"
      );
      expect(await resolver.getSubject("resend:bot@example.com:abc123")).toBe(
        "First Subject"
      );
    });

    it("returns undefined for unknown thread", async () => {
      const resolver = new ThreadResolver();
      expect(
        await resolver.getSubject("resend:bot@example.com:unknown")
      ).toBeUndefined();
    });
  });
});
