import { describe, it, expect } from "vitest";
import { ThreadResolver } from "../src/thread-resolver.js";
import type { ResendThreadId } from "../src/types.js";

describe("ThreadResolver", () => {
  const resolver = new ThreadResolver();

  describe("encodeThreadId", () => {
    it("encodes to resend:{to}:{hash} format", () => {
      const id: ResendThreadId = {
        toAddress: "bot@example.com",
        rootMessageIdHash: "a1b2c3d4e5f6a7b8",
      };
      expect(resolver.encodeThreadId(id)).toBe("resend:bot@example.com:a1b2c3d4e5f6a7b8");
    });
  });

  describe("decodeThreadId", () => {
    it("decodes resend:{to}:{hash} format", () => {
      const decoded = resolver.decodeThreadId("resend:bot@example.com:a1b2c3d4e5f6a7b8");
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
      expect(threadId).toMatch(/^resend:bot@example\.com:[0-9a-f]{16}$/);
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
  });

  describe("getReplyHeaders", () => {
    it("returns In-Reply-To and References for a thread", () => {
      const resolver = new ThreadResolver();
      resolver.trackMessage("resend:bot@example.com:abc123", "<msg@test.com>");
      const headers = resolver.getReplyHeaders("resend:bot@example.com:abc123", "<msg@test.com>");
      expect(headers["In-Reply-To"]).toBe("<msg@test.com>");
      expect(headers["References"]).toContain("<msg@test.com>");
    });
  });
});
