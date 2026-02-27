# Resend Chat SDK Adapter — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build `@chat-adapter/resend`, a standalone npm package implementing a Vercel Chat SDK adapter for Resend email with bidirectional communication.

**Architecture:** Adapter implements `Adapter<ResendThreadId, ResendRawMessage>`. Inbound: Resend webhooks → webhook handler → message parser → `chat.processMessage()`. Outbound: `postMessage()` → message renderer (with card support via react-email) → `resend.emails.send()`. Threading via `Message-ID`/`In-Reply-To`/`References` headers.

**Tech Stack:** TypeScript, Vitest, Resend SDK 6.9.2, react-email (components 1.0.8, render 2.0.4), Chat SDK 4.15.0

**Design doc:** `docs/plans/2025-02-27-resend-adapter-design.md`

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/index.ts` (empty placeholder)

**Step 1: Create `package.json`**

```json
{
  "name": "@chat-adapter/resend",
  "version": "0.1.0",
  "description": "Vercel Chat SDK adapter for Resend email",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "chat": "4.15.0",
    "@chat-adapter/shared": "4.15.0"
  },
  "dependencies": {
    "resend": "6.9.2",
    "@react-email/components": "1.0.8",
    "@react-email/render": "2.0.4"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "@types/node": "^22.0.0",
    "chat": "4.15.0",
    "@chat-adapter/shared": "4.15.0"
  },
  "files": ["dist"],
  "license": "MIT"
}
```

**Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "test"]
}
```

**Step 3: Create `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
```

**Step 4: Create empty `src/index.ts`**

```typescript
// @chat-adapter/resend
```

**Step 5: Install dependencies**

Run: `npm install`
Expected: Clean install, `node_modules/` created, `package-lock.json` generated.

**Step 6: Verify setup**

Run: `npx tsc --noEmit && npx vitest run`
Expected: TypeScript compiles (no files to check), vitest runs (no tests found, exits 0 or warns).

**Step 7: Commit**

```bash
git init && git add -A && git commit -m "scaffold: project setup with deps"
```

---

### Task 2: Types

**Files:**
- Create: `src/types.ts`
- Modify: `src/index.ts` (re-export types)

**Step 1: Create `src/types.ts`**

```typescript
/**
 * Decoded thread identifier for Resend email threads.
 * Encoded format: `resend:{toAddress}:{rootMessageIdHash}`
 */
export interface ResendThreadId {
  /** First recipient email address — acts as "channel" identifier */
  toAddress: string;
  /** SHA-256 hash (first 16 hex chars) of the root Message-ID */
  rootMessageIdHash: string;
}

/**
 * Raw email message as received from or sent via Resend.
 * This is the TRawMessage generic parameter for the adapter.
 */
export interface ResendRawMessage {
  /** Resend email ID (e.g., "re_abc123") */
  id: string;
  /** RFC 822 Message-ID header (e.g., "<abc@mail.resend.dev>") */
  messageId: string;
  /** Sender email address */
  from: string;
  /** Recipient email addresses */
  to: string[];
  /** CC recipients */
  cc?: string[];
  /** Email subject line */
  subject: string;
  /** Plain text body */
  text?: string;
  /** HTML body */
  html?: string;
  /** Email headers (In-Reply-To, References, etc.) */
  headers?: Record<string, string>;
  /** File attachments */
  attachments?: ResendAttachment[];
  /** ISO 8601 timestamp */
  createdAt: string;
}

/**
 * Email attachment metadata.
 */
export interface ResendAttachment {
  /** Filename */
  filename: string;
  /** MIME type */
  contentType: string;
  /** Download URL (inbound emails) */
  url?: string;
  /** Base64-encoded content (outbound emails) */
  content?: string;
}

/**
 * Configuration for the Resend adapter.
 */
export interface ResendAdapterConfig {
  /** Resend API key. Falls back to RESEND_API_KEY env var. */
  apiKey?: string;
  /** Resend webhook signing secret. Falls back to RESEND_WEBHOOK_SECRET env var. */
  webhookSecret?: string;
  /** Sender email address (required). */
  fromAddress: string;
  /** Display name for the From header (optional). */
  fromName?: string;
}

/**
 * Resend webhook event payload for email.received events.
 * Contains metadata only — body must be fetched via receiving API.
 */
export interface ResendWebhookPayload {
  type: "email.received";
  created_at: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    message_id: string;
    attachments?: Array<{
      filename: string;
      content_type: string;
    }>;
  };
}

/**
 * Full email content retrieved via Resend Receiving API.
 */
export interface ResendReceivedEmail {
  id: string;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  message_id: string;
  html?: string;
  text?: string;
  headers?: Record<string, string>;
  created_at: string;
  attachments?: Array<{
    filename: string;
    content_type: string;
  }>;
}
```

**Step 2: Update `src/index.ts`**

```typescript
// @chat-adapter/resend
export type {
  ResendThreadId,
  ResendRawMessage,
  ResendAttachment,
  ResendAdapterConfig,
  ResendWebhookPayload,
  ResendReceivedEmail,
} from "./types.js";
```

**Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: add type definitions"
```

---

### Task 3: Utils (SHA-256 hash, email parsing)

**Files:**
- Create: `src/utils.ts`
- Create: `test/utils.test.ts`

**Step 1: Write failing tests**

```typescript
// test/utils.test.ts
import { describe, it, expect } from "vitest";
import { hashMessageId, parseEmailAddress, generateMessageId } from "../src/utils.js";

describe("hashMessageId", () => {
  it("returns 16-char hex string", async () => {
    const hash = await hashMessageId("<abc123@mail.resend.dev>");
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("returns same hash for same input", async () => {
    const a = await hashMessageId("<test@example.com>");
    const b = await hashMessageId("<test@example.com>");
    expect(a).toBe(b);
  });

  it("returns different hashes for different inputs", async () => {
    const a = await hashMessageId("<a@example.com>");
    const b = await hashMessageId("<b@example.com>");
    expect(a).not.toBe(b);
  });
});

describe("parseEmailAddress", () => {
  it("extracts email from angle bracket format", () => {
    expect(parseEmailAddress("John Doe <john@example.com>")).toBe("john@example.com");
  });

  it("returns plain email as-is", () => {
    expect(parseEmailAddress("john@example.com")).toBe("john@example.com");
  });

  it("lowercases email", () => {
    expect(parseEmailAddress("John@Example.COM")).toBe("john@example.com");
  });

  it("trims whitespace", () => {
    expect(parseEmailAddress("  john@example.com  ")).toBe("john@example.com");
  });
});

describe("generateMessageId", () => {
  it("produces valid Message-ID format", () => {
    const id = generateMessageId("bot@example.com");
    expect(id).toMatch(/^<.+@example\.com>$/);
  });

  it("generates unique IDs", () => {
    const a = generateMessageId("bot@example.com");
    const b = generateMessageId("bot@example.com");
    expect(a).not.toBe(b);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/utils.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement `src/utils.ts`**

```typescript
import { createHash, randomUUID } from "node:crypto";

/**
 * SHA-256 hash of a Message-ID, truncated to first 16 hex chars.
 * Used as the thread-identifying component of encoded thread IDs.
 */
export async function hashMessageId(messageId: string): Promise<string> {
  const hash = createHash("sha256").update(messageId).digest("hex");
  return hash.slice(0, 16);
}

/**
 * Extract bare email address from a formatted email string.
 * Handles "Name <email>" format and plain "email" format.
 */
export function parseEmailAddress(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/<([^>]+)>/);
  const email = match ? match[1] : trimmed;
  return email.toLowerCase();
}

/**
 * Generate a unique RFC 822 Message-ID for outbound emails.
 */
export function generateMessageId(fromAddress: string): string {
  const domain = fromAddress.split("@")[1] || "resend.dev";
  const unique = randomUUID();
  return `<${unique}@${domain}>`;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run test/utils.test.ts`
Expected: All 7 tests pass.

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: add utils (hash, email parsing, message-id gen)"
```

---

### Task 4: Thread Resolver

**Files:**
- Create: `src/thread-resolver.ts`
- Create: `test/thread-resolver.test.ts`

**Step 1: Write failing tests**

```typescript
// test/thread-resolver.test.ts
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
      const threadId = await resolver.resolveThreadId({
        toAddress: "bot@example.com",
        messageId: "<msg1@mail.resend.dev>",
        inReplyTo: undefined,
        references: undefined,
      });
      expect(threadId).toMatch(/^resend:bot@example\.com:[0-9a-f]{16}$/);
    });

    it("resolves to existing thread for reply", async () => {
      // First, create the original thread
      const original = await resolver.resolveThreadId({
        toAddress: "bot@example.com",
        messageId: "<original@mail.resend.dev>",
        inReplyTo: undefined,
        references: undefined,
      });

      // Reply references the original
      const reply = await resolver.resolveThreadId({
        toAddress: "bot@example.com",
        messageId: "<reply@mail.resend.dev>",
        inReplyTo: "<original@mail.resend.dev>",
        references: "<original@mail.resend.dev>",
      });

      expect(reply).toBe(original);
    });

    it("uses first reference as root for deep threads", async () => {
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
      resolver.trackMessage("resend:bot@example.com:abc123", "<msg@test.com>");
      const headers = resolver.getReplyHeaders("resend:bot@example.com:abc123", "<msg@test.com>");
      expect(headers["In-Reply-To"]).toBe("<msg@test.com>");
      expect(headers["References"]).toContain("<msg@test.com>");
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/thread-resolver.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement `src/thread-resolver.ts`**

```typescript
import { hashMessageId } from "./utils.js";
import type { ResendThreadId } from "./types.js";

interface ResolveInput {
  toAddress: string;
  messageId: string;
  inReplyTo: string | undefined;
  references: string | undefined;
}

/**
 * Manages email thread identification using Message-ID / In-Reply-To / References headers.
 * Maintains an in-memory mapping of message IDs to thread IDs,
 * and a per-thread list of known message IDs for building References headers.
 */
export class ThreadResolver {
  /** Map from Message-ID to encoded thread ID */
  private messageToThread = new Map<string, string>();
  /** Map from encoded thread ID to ordered list of Message-IDs */
  private threadMessages = new Map<string, string[]>();

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

  /**
   * Resolve an inbound email to an encoded thread ID.
   * Creates a new thread if this is a root message (no In-Reply-To).
   * Finds existing thread if this is a reply.
   */
  async resolveThreadId(input: ResolveInput): Promise<string> {
    const { toAddress, messageId, inReplyTo, references } = input;

    // Check if this message is a reply — look up parent thread
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

    // New thread — hash this message's ID as root
    const hash = await hashMessageId(messageId);
    const threadId = this.encodeThreadId({ toAddress, rootMessageIdHash: hash });
    this.trackMessage(threadId, messageId);
    return threadId;
  }

  /**
   * Track a message ID as belonging to a thread.
   */
  trackMessage(threadId: string, messageId: string): void {
    this.messageToThread.set(messageId, threadId);
    const messages = this.threadMessages.get(threadId) || [];
    if (!messages.includes(messageId)) {
      messages.push(messageId);
    }
    this.threadMessages.set(threadId, messages);
  }

  /**
   * Get reply headers (In-Reply-To, References) for sending a reply in a thread.
   */
  getReplyHeaders(
    threadId: string,
    lastMessageId: string,
  ): Record<string, string> {
    const messages = this.threadMessages.get(threadId) || [];
    return {
      "In-Reply-To": lastMessageId,
      References: messages.join(" "),
    };
  }

  /**
   * Find the root Message-ID from In-Reply-To and References headers.
   * The first entry in References is typically the root.
   */
  private findRootMessageId(
    inReplyTo: string | undefined,
    references: string | undefined,
  ): string | undefined {
    if (references) {
      const refs = references.trim().split(/\s+/);
      if (refs.length > 0) {
        return refs[0];
      }
    }
    return inReplyTo;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run test/thread-resolver.test.ts`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: add thread resolver (encode/decode/resolve/reply headers)"
```

---

### Task 5: Format Converter

**Files:**
- Create: `src/format-converter.ts`
- Create: `test/format-converter.test.ts`

**Step 1: Write failing tests**

```typescript
// test/format-converter.test.ts
import { describe, it, expect } from "vitest";
import { ResendFormatConverter } from "../src/format-converter.js";

describe("ResendFormatConverter", () => {
  const converter = new ResendFormatConverter();

  describe("fromAst", () => {
    it("converts paragraph to HTML", () => {
      const ast = {
        type: "root" as const,
        children: [
          {
            type: "paragraph" as const,
            children: [{ type: "text" as const, value: "Hello world" }],
          },
        ],
      };
      const html = converter.fromAst(ast);
      expect(html).toContain("Hello world");
      expect(html).toContain("<p>");
    });

    it("converts bold text", () => {
      const ast = {
        type: "root" as const,
        children: [
          {
            type: "paragraph" as const,
            children: [
              {
                type: "strong" as const,
                children: [{ type: "text" as const, value: "bold" }],
              },
            ],
          },
        ],
      };
      const html = converter.fromAst(ast);
      expect(html).toContain("<strong>");
      expect(html).toContain("bold");
    });

    it("converts links", () => {
      const ast = {
        type: "root" as const,
        children: [
          {
            type: "paragraph" as const,
            children: [
              {
                type: "link" as const,
                url: "https://example.com",
                children: [{ type: "text" as const, value: "click here" }],
              },
            ],
          },
        ],
      };
      const html = converter.fromAst(ast);
      expect(html).toContain('href="https://example.com"');
      expect(html).toContain("click here");
    });
  });

  describe("toAst", () => {
    it("converts plain text to paragraph AST", () => {
      const ast = converter.toAst("Hello world");
      expect(ast.type).toBe("root");
      expect(ast.children).toHaveLength(1);
      expect(ast.children[0].type).toBe("paragraph");
    });

    it("handles multi-line text", () => {
      const ast = converter.toAst("Line 1\n\nLine 2");
      expect(ast.type).toBe("root");
      expect(ast.children.length).toBeGreaterThanOrEqual(2);
    });

    it("handles empty string", () => {
      const ast = converter.toAst("");
      expect(ast.type).toBe("root");
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/format-converter.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement `src/format-converter.ts`**

Note: We need `mdast-util-to-hast` and `hast-util-to-html` for AST→HTML conversion. Add these as dependencies first:

Run: `npm install mdast-util-to-hast hast-util-to-html`

```typescript
import { toHast } from "mdast-util-to-hast";
import { toHtml } from "hast-util-to-html";
import type { Root, RootContent } from "mdast";

/**
 * Converts between mdast AST (Chat SDK internal format) and HTML (email body).
 */
export class ResendFormatConverter {
  /**
   * Convert mdast AST to HTML string for email body.
   */
  fromAst(ast: Root): string {
    const hast = toHast(ast);
    if (!hast) return "";
    return toHtml(hast);
  }

  /**
   * Convert plain text to mdast AST.
   * Splits on double newlines into paragraphs.
   */
  toAst(text: string): Root {
    if (!text || text.trim() === "") {
      return { type: "root", children: [] };
    }

    const paragraphs = text.split(/\n\n+/);
    const children: RootContent[] = paragraphs
      .filter((p) => p.trim() !== "")
      .map((p) => ({
        type: "paragraph" as const,
        children: [{ type: "text" as const, value: p.trim() }],
      }));

    return { type: "root", children };
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run test/format-converter.test.ts`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: add format converter (mdast <-> HTML)"
```

---

### Task 6: Card Renderer

**Files:**
- Create: `src/card-renderer.tsx`
- Create: `test/card-renderer.test.ts`

**Step 1: Write failing tests**

```typescript
// test/card-renderer.test.ts
import { describe, it, expect } from "vitest";
import { renderCard } from "../src/card-renderer.js";

describe("renderCard", () => {
  it("renders a card with header and text", async () => {
    const card = {
      type: "card",
      children: [
        { type: "card.header", props: {}, children: "Welcome" },
        { type: "card.text", props: {}, children: "Hello world" },
      ],
    };
    const html = await renderCard(card);
    expect(html).toContain("Welcome");
    expect(html).toContain("Hello world");
  });

  it("renders a button with URL", async () => {
    const card = {
      type: "card",
      children: [
        {
          type: "card.button",
          props: { href: "https://example.com" },
          children: "Click me",
        },
      ],
    };
    const html = await renderCard(card);
    expect(html).toContain("https://example.com");
    expect(html).toContain("Click me");
  });

  it("renders an image", async () => {
    const card = {
      type: "card",
      children: [
        {
          type: "card.image",
          props: { src: "https://example.com/img.png", alt: "Test image" },
          children: null,
        },
      ],
    };
    const html = await renderCard(card);
    expect(html).toContain("https://example.com/img.png");
  });

  it("renders a divider", async () => {
    const card = {
      type: "card",
      children: [
        { type: "card.text", props: {}, children: "Before" },
        { type: "card.divider", props: {}, children: null },
        { type: "card.text", props: {}, children: "After" },
      ],
    };
    const html = await renderCard(card);
    expect(html).toContain("Before");
    expect(html).toContain("After");
    expect(html).toContain("<hr");
  });

  it("renders a link", async () => {
    const card = {
      type: "card",
      children: [
        {
          type: "card.link",
          props: { href: "https://example.com" },
          children: "Example",
        },
      ],
    };
    const html = await renderCard(card);
    expect(html).toContain("https://example.com");
    expect(html).toContain("Example");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/card-renderer.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement `src/card-renderer.tsx`**

```tsx
import { render } from "@react-email/render";
import {
  Html,
  Body,
  Container,
  Section,
  Text,
  Heading,
  Button,
  Link,
  Img,
  Hr,
} from "@react-email/components";
import React from "react";

interface CardNode {
  type: string;
  props?: Record<string, unknown>;
  children?: CardNode[] | string | null;
}

function renderNode(node: CardNode): React.ReactNode {
  const children =
    typeof node.children === "string"
      ? node.children
      : Array.isArray(node.children)
        ? node.children.map((child, i) => <React.Fragment key={i}>{renderNode(child)}</React.Fragment>)
        : null;

  switch (node.type) {
    case "card":
      return <Section>{children}</Section>;
    case "card.header":
      return <Heading as="h2">{children}</Heading>;
    case "card.body":
      return <Section>{children}</Section>;
    case "card.text":
      return <Text>{children}</Text>;
    case "card.button":
      return (
        <Button href={(node.props?.href as string) || "#"}>
          {children}
        </Button>
      );
    case "card.image":
      return (
        <Img
          src={(node.props?.src as string) || ""}
          alt={(node.props?.alt as string) || ""}
          width={node.props?.width as number | undefined}
        />
      );
    case "card.divider":
      return <Hr />;
    case "card.link":
      return (
        <Link href={(node.props?.href as string) || "#"}>
          {children}
        </Link>
      );
    default:
      return <Text>{children}</Text>;
  }
}

/**
 * Render a Chat SDK Card element tree to HTML string for email.
 * Uses react-email components for email-client-compatible HTML output.
 */
export async function renderCard(card: CardNode): Promise<string> {
  const emailComponent = (
    <Html>
      <Body>
        <Container>{renderNode(card)}</Container>
      </Body>
    </Html>
  );

  return render(emailComponent);
}
```

Note: Need to add `react` and `@types/react` as dev dependencies:
Run: `npm install -D react @types/react`

**Step 4: Run tests to verify they pass**

Run: `npx vitest run test/card-renderer.test.ts`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: add card renderer (card JSX -> email HTML via react-email)"
```

---

### Task 7: Message Renderer

**Files:**
- Create: `src/message-renderer.ts`
- Create: `test/message-renderer.test.ts`

**Step 1: Write failing tests**

```typescript
// test/message-renderer.test.ts
import { describe, it, expect } from "vitest";
import { renderMessage } from "../src/message-renderer.js";

describe("renderMessage", () => {
  it("renders plain text to html and text", async () => {
    const result = await renderMessage({ text: "Hello world" });
    expect(result.html).toContain("Hello world");
    expect(result.text).toBe("Hello world");
  });

  it("renders formatted content (mdast AST) to html", async () => {
    const result = await renderMessage({
      formatted: {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [
              { type: "strong", children: [{ type: "text", value: "bold" }] },
            ],
          },
        ],
      },
    });
    expect(result.html).toContain("<strong>");
    expect(result.html).toContain("bold");
    expect(result.text).toBeTruthy();
  });

  it("renders card content to email HTML", async () => {
    const result = await renderMessage({
      card: {
        type: "card",
        children: [
          { type: "card.text", props: {}, children: "Card content" },
        ],
      },
    });
    expect(result.html).toContain("Card content");
    expect(result.text).toContain("Card content");
  });

  it("prefers card over text when both present", async () => {
    const result = await renderMessage({
      text: "Fallback text",
      card: {
        type: "card",
        children: [
          { type: "card.text", props: {}, children: "Card wins" },
        ],
      },
    });
    expect(result.html).toContain("Card wins");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/message-renderer.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement `src/message-renderer.ts`**

```typescript
import { ResendFormatConverter } from "./format-converter.js";
import { renderCard } from "./card-renderer.js";
import type { Root } from "mdast";

interface RenderInput {
  text?: string;
  formatted?: Root;
  card?: {
    type: string;
    props?: Record<string, unknown>;
    children?: unknown[];
  };
}

interface RenderOutput {
  html: string;
  text: string;
}

const converter = new ResendFormatConverter();

/**
 * Render an outbound message to HTML + plain text for email sending.
 * Priority: card > formatted > text.
 */
export async function renderMessage(input: RenderInput): Promise<RenderOutput> {
  // Card takes priority
  if (input.card) {
    const html = await renderCard(input.card as Parameters<typeof renderCard>[0]);
    const text = extractTextFromCard(input.card) || input.text || "";
    return { html, text };
  }

  // Formatted (mdast AST)
  if (input.formatted) {
    const html = converter.fromAst(input.formatted);
    const text = input.text || stripHtml(html);
    return { html, text };
  }

  // Plain text
  const text = input.text || "";
  const html = `<p>${escapeHtml(text)}</p>`;
  return { html, text };
}

function extractTextFromCard(card: Record<string, unknown>): string {
  const parts: string[] = [];
  const children = card.children as Array<Record<string, unknown>> | undefined;
  if (!children) return "";

  for (const child of children) {
    if (typeof child.children === "string") {
      parts.push(child.children);
    } else if (Array.isArray(child.children)) {
      parts.push(extractTextFromCard(child));
    }
  }
  return parts.join("\n");
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run test/message-renderer.test.ts`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: add message renderer (text/formatted/card -> email HTML)"
```

---

### Task 8: Message Parser

**Files:**
- Create: `src/message-parser.ts`
- Create: `test/message-parser.test.ts`

**Step 1: Write failing tests**

```typescript
// test/message-parser.test.ts
import { describe, it, expect } from "vitest";
import { parseInboundEmail } from "../src/message-parser.js";
import type { ResendReceivedEmail } from "../src/types.js";

describe("parseInboundEmail", () => {
  const baseEmail: ResendReceivedEmail = {
    id: "re_123",
    from: "user@example.com",
    to: ["bot@example.com"],
    subject: "Test email",
    message_id: "<msg1@mail.resend.dev>",
    text: "Hello bot",
    html: "<p>Hello bot</p>",
    created_at: "2025-01-01T00:00:00Z",
  };

  it("parses basic email fields", () => {
    const result = parseInboundEmail(baseEmail, "resend:bot@example.com:abc123");
    expect(result.id).toBe("re_123");
    expect(result.threadId).toBe("resend:bot@example.com:abc123");
    expect(result.text).toBe("Hello bot");
    expect(result.author.name).toBe("user@example.com");
    expect(result.isMention).toBe(true);
  });

  it("extracts author from email address", () => {
    const email = { ...baseEmail, from: "John Doe <john@example.com>" };
    const result = parseInboundEmail(email, "thread1");
    expect(result.author.id).toBe("john@example.com");
    expect(result.author.name).toContain("John Doe");
  });

  it("includes subject in metadata", () => {
    const result = parseInboundEmail(baseEmail, "thread1");
    expect(result.metadata.subject).toBe("Test email");
  });

  it("parses attachments", () => {
    const email: ResendReceivedEmail = {
      ...baseEmail,
      attachments: [
        { filename: "doc.pdf", content_type: "application/pdf" },
      ],
    };
    const result = parseInboundEmail(email, "thread1");
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].filename).toBe("doc.pdf");
  });

  it("uses text body, falls back to stripped html", () => {
    const htmlOnly: ResendReceivedEmail = {
      ...baseEmail,
      text: undefined,
      html: "<p>HTML only</p>",
    };
    const result = parseInboundEmail(htmlOnly, "thread1");
    expect(result.text).toContain("HTML only");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/message-parser.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement `src/message-parser.ts`**

```typescript
import { parseEmailAddress } from "./utils.js";
import { ResendFormatConverter } from "./format-converter.js";
import type { ResendReceivedEmail, ResendRawMessage } from "./types.js";

interface ParsedMessage {
  id: string;
  threadId: string;
  text: string;
  formatted: ReturnType<ResendFormatConverter["toAst"]>;
  raw: ResendRawMessage;
  author: {
    id: string;
    name: string;
    isBot: boolean;
  };
  metadata: {
    subject: string;
    messageId: string;
    [key: string]: unknown;
  };
  attachments: Array<{
    filename: string;
    contentType: string;
    url?: string;
  }>;
  isMention: boolean;
}

const converter = new ResendFormatConverter();

/**
 * Parse an inbound Resend email into the Chat SDK Message shape.
 */
export function parseInboundEmail(
  email: ResendReceivedEmail,
  threadId: string,
): ParsedMessage {
  const authorEmail = parseEmailAddress(email.from);
  const authorName = extractDisplayName(email.from);
  const text = email.text || stripHtml(email.html || "");
  const formatted = converter.toAst(text);

  const raw: ResendRawMessage = {
    id: email.id,
    messageId: email.message_id,
    from: email.from,
    to: email.to,
    cc: email.cc,
    subject: email.subject,
    text: email.text,
    html: email.html,
    headers: email.headers,
    createdAt: email.created_at,
  };

  return {
    id: email.id,
    threadId,
    text,
    formatted,
    raw,
    author: {
      id: authorEmail,
      name: authorName,
      isBot: false,
    },
    metadata: {
      subject: email.subject,
      messageId: email.message_id,
    },
    attachments: (email.attachments || []).map((a) => ({
      filename: a.filename,
      contentType: a.content_type,
    })),
    isMention: true,
  };
}

function extractDisplayName(from: string): string {
  const match = from.match(/^([^<]+)<[^>]+>$/);
  if (match) {
    return match[1].trim();
  }
  return from;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim();
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run test/message-parser.test.ts`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: add message parser (inbound email -> Chat SDK message)"
```

---

### Task 9: Test Fixtures

**Files:**
- Create: `test/fixtures/webhook-payloads.ts`

**Step 1: Create fixture file**

```typescript
// test/fixtures/webhook-payloads.ts
import type { ResendWebhookPayload, ResendReceivedEmail } from "../../src/types.js";

export const validWebhookPayload: ResendWebhookPayload = {
  type: "email.received",
  created_at: "2025-01-15T10:30:00Z",
  data: {
    email_id: "re_webhook_123",
    from: "sender@example.com",
    to: ["bot@example.com"],
    subject: "Test webhook email",
    message_id: "<webhook-msg-1@mail.resend.dev>",
  },
};

export const replyWebhookPayload: ResendWebhookPayload = {
  type: "email.received",
  created_at: "2025-01-15T10:35:00Z",
  data: {
    email_id: "re_webhook_456",
    from: "sender@example.com",
    to: ["bot@example.com"],
    subject: "Re: Test webhook email",
    message_id: "<webhook-msg-2@mail.resend.dev>",
  },
};

export const receivedEmail: ResendReceivedEmail = {
  id: "re_webhook_123",
  from: "sender@example.com",
  to: ["bot@example.com"],
  subject: "Test webhook email",
  message_id: "<webhook-msg-1@mail.resend.dev>",
  text: "Hello from the webhook test!",
  html: "<p>Hello from the webhook test!</p>",
  headers: {},
  created_at: "2025-01-15T10:30:00Z",
};

export const receivedReplyEmail: ResendReceivedEmail = {
  id: "re_webhook_456",
  from: "sender@example.com",
  to: ["bot@example.com"],
  subject: "Re: Test webhook email",
  message_id: "<webhook-msg-2@mail.resend.dev>",
  text: "This is a reply!",
  html: "<p>This is a reply!</p>",
  headers: {
    "In-Reply-To": "<webhook-msg-1@mail.resend.dev>",
    References: "<webhook-msg-1@mail.resend.dev>",
  },
  created_at: "2025-01-15T10:35:00Z",
};

export const emailWithAttachments: ResendReceivedEmail = {
  ...receivedEmail,
  id: "re_with_attach",
  attachments: [
    { filename: "document.pdf", content_type: "application/pdf" },
    { filename: "image.png", content_type: "image/png" },
  ],
};

/** Svix webhook headers for testing */
export const validWebhookHeaders = {
  "svix-id": "msg_test_123",
  "svix-timestamp": "1705312200",
  "svix-signature": "v1,test_signature_placeholder",
};
```

**Step 2: Commit**

```bash
git add -A && git commit -m "feat: add test fixtures for webhook payloads"
```

---

### Task 10: Webhook Handler

**Files:**
- Create: `src/webhook-handler.ts`
- Create: `test/webhook-handler.test.ts`

**Step 1: Write failing tests**

```typescript
// test/webhook-handler.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebhookHandler } from "../src/webhook-handler.js";

// Mock resend
const mockVerify = vi.fn();
const mockReceivingGet = vi.fn();

const mockResend = {
  webhooks: { verify: mockVerify },
  emails: { receiving: { get: mockReceivingGet } },
};

describe("WebhookHandler", () => {
  let handler: WebhookHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new WebhookHandler(mockResend as any, "whsec_test123");
  });

  describe("parseWebhookRequest", () => {
    it("returns 401 for invalid signature", async () => {
      mockVerify.mockImplementation(() => {
        throw new Error("Invalid signature");
      });

      const request = new Request("https://example.com/webhook", {
        method: "POST",
        headers: {
          "svix-id": "msg_123",
          "svix-timestamp": "12345",
          "svix-signature": "v1,invalid",
        },
        body: JSON.stringify({ type: "email.received", data: {} }),
      });

      const result = await handler.parseWebhookRequest(request);
      expect(result.status).toBe(401);
    });

    it("returns 200 for non-email.received events", async () => {
      mockVerify.mockReturnValue({ type: "email.sent", data: {} });

      const request = new Request("https://example.com/webhook", {
        method: "POST",
        headers: {
          "svix-id": "msg_123",
          "svix-timestamp": "12345",
          "svix-signature": "v1,valid",
        },
        body: JSON.stringify({ type: "email.sent", data: {} }),
      });

      const result = await handler.parseWebhookRequest(request);
      expect(result.status).toBe(200);
      expect(result.event).toBeNull();
    });

    it("returns parsed event for email.received", async () => {
      const payload = {
        type: "email.received",
        created_at: "2025-01-01T00:00:00Z",
        data: {
          email_id: "re_123",
          from: "user@example.com",
          to: ["bot@example.com"],
          subject: "Test",
          message_id: "<test@mail.resend.dev>",
        },
      };
      mockVerify.mockReturnValue(payload);

      const request = new Request("https://example.com/webhook", {
        method: "POST",
        headers: {
          "svix-id": "msg_123",
          "svix-timestamp": "12345",
          "svix-signature": "v1,valid",
        },
        body: JSON.stringify(payload),
      });

      const result = await handler.parseWebhookRequest(request);
      expect(result.status).toBe(200);
      expect(result.event).not.toBeNull();
      expect(result.event!.data.email_id).toBe("re_123");
    });
  });

  describe("fetchEmailContent", () => {
    it("fetches full email via receiving API", async () => {
      const email = {
        id: "re_123",
        from: "user@example.com",
        to: ["bot@example.com"],
        subject: "Test",
        message_id: "<test@mail.resend.dev>",
        text: "Hello",
        html: "<p>Hello</p>",
        created_at: "2025-01-01T00:00:00Z",
      };
      mockReceivingGet.mockResolvedValue({ data: email });

      const result = await handler.fetchEmailContent("re_123");
      expect(result).toEqual(email);
      expect(mockReceivingGet).toHaveBeenCalledWith("re_123");
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/webhook-handler.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement `src/webhook-handler.ts`**

```typescript
import type { Resend } from "resend";
import type { ResendWebhookPayload, ResendReceivedEmail } from "./types.js";

interface WebhookResult {
  status: number;
  event: ResendWebhookPayload | null;
}

/**
 * Handles Resend webhook verification and event parsing.
 */
export class WebhookHandler {
  constructor(
    private resend: Resend,
    private webhookSecret: string,
  ) {}

  /**
   * Parse and verify an incoming webhook request.
   * Returns the event payload if valid email.received, null for other event types.
   */
  async parseWebhookRequest(request: Request): Promise<WebhookResult> {
    const body = await request.text();
    const svixId = request.headers.get("svix-id") || "";
    const svixTimestamp = request.headers.get("svix-timestamp") || "";
    const svixSignature = request.headers.get("svix-signature") || "";

    // Verify webhook signature
    let payload: Record<string, unknown>;
    try {
      payload = (this.resend.webhooks as any).verify(body, {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      }) as Record<string, unknown>;
    } catch {
      return { status: 401, event: null };
    }

    // Only process email.received events
    if (payload.type !== "email.received") {
      return { status: 200, event: null };
    }

    return {
      status: 200,
      event: payload as unknown as ResendWebhookPayload,
    };
  }

  /**
   * Fetch full email content via Resend Receiving API.
   */
  async fetchEmailContent(emailId: string): Promise<ResendReceivedEmail> {
    const response = await (this.resend.emails as any).receiving.get(emailId);
    return response.data as ResendReceivedEmail;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run test/webhook-handler.test.ts`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: add webhook handler (verify + parse + fetch content)"
```

---

### Task 11: Adapter Core

**Files:**
- Create: `src/adapter.ts`
- Create: `test/adapter.test.ts`

**Step 1: Write failing tests**

```typescript
// test/adapter.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ResendAdapter } from "../src/adapter.js";
import type { ResendAdapterConfig } from "../src/types.js";

// Mock Resend SDK
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: {
      send: vi.fn().mockResolvedValue({
        data: { id: "re_sent_123" },
      }),
      receiving: {
        get: vi.fn(),
      },
    },
    webhooks: {
      verify: vi.fn(),
    },
  })),
}));

const config: ResendAdapterConfig = {
  apiKey: "re_test_123",
  webhookSecret: "whsec_test",
  fromAddress: "bot@example.com",
  fromName: "Test Bot",
};

describe("ResendAdapter", () => {
  let adapter: ResendAdapter;

  beforeEach(() => {
    adapter = new ResendAdapter(config);
  });

  describe("properties", () => {
    it("has correct name", () => {
      expect(adapter.name).toBe("resend");
    });

    it("has correct userName", () => {
      expect(adapter.userName).toBe("bot@example.com");
    });
  });

  describe("initialize", () => {
    it("stores chat instance reference", async () => {
      const mockChat = { processMessage: vi.fn() };
      await adapter.initialize(mockChat as any);
      // Should not throw
    });

    it("throws AuthenticationError without API key", async () => {
      const noKeyAdapter = new ResendAdapter({
        ...config,
        apiKey: undefined,
      });
      // Remove env var too
      const env = process.env.RESEND_API_KEY;
      delete process.env.RESEND_API_KEY;
      await expect(noKeyAdapter.initialize({} as any)).rejects.toThrow();
      if (env) process.env.RESEND_API_KEY = env;
    });
  });

  describe("encodeThreadId / decodeThreadId", () => {
    it("roundtrips thread ID", () => {
      const encoded = adapter.encodeThreadId({
        toAddress: "bot@example.com",
        rootMessageIdHash: "abcdef0123456789",
      });
      const decoded = adapter.decodeThreadId(encoded);
      expect(decoded.toAddress).toBe("bot@example.com");
      expect(decoded.rootMessageIdHash).toBe("abcdef0123456789");
    });
  });

  describe("postMessage", () => {
    it("sends email via Resend", async () => {
      const mockChat = { processMessage: vi.fn() };
      await adapter.initialize(mockChat as any);

      const result = await adapter.postMessage(
        "resend:user@example.com:abcdef0123456789",
        { text: "Hello from bot" },
      );
      expect(result.id).toBe("re_sent_123");
      expect(result.threadId).toBe("resend:user@example.com:abcdef0123456789");
    });
  });

  describe("unsupported operations", () => {
    it("editMessage throws NotImplementedError", async () => {
      await expect(
        adapter.editMessage("thread", "msg", { text: "edited" }),
      ).rejects.toThrow(/not implemented|not supported/i);
    });

    it("deleteMessage throws NotImplementedError", async () => {
      await expect(
        adapter.deleteMessage("thread", "msg"),
      ).rejects.toThrow(/not implemented|not supported/i);
    });

    it("addReaction throws NotImplementedError", async () => {
      await expect(
        adapter.addReaction("thread", "msg", "thumbsup"),
      ).rejects.toThrow(/not implemented|not supported/i);
    });

    it("removeReaction throws NotImplementedError", async () => {
      await expect(
        adapter.removeReaction("thread", "msg", "thumbsup"),
      ).rejects.toThrow(/not implemented|not supported/i);
    });

    it("startTyping throws NotImplementedError", async () => {
      await expect(
        adapter.startTyping("thread"),
      ).rejects.toThrow(/not implemented|not supported/i);
    });
  });

  describe("renderFormatted", () => {
    it("converts formatted content to HTML", () => {
      const html = adapter.renderFormatted({
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", value: "test" }],
          },
        ],
      });
      expect(html).toContain("test");
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/adapter.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement `src/adapter.ts`**

```typescript
import { Resend } from "resend";
import { ThreadResolver } from "./thread-resolver.js";
import { WebhookHandler } from "./webhook-handler.js";
import { ResendFormatConverter } from "./format-converter.js";
import { parseInboundEmail } from "./message-parser.js";
import { renderMessage } from "./message-renderer.js";
import { generateMessageId, parseEmailAddress, hashMessageId } from "./utils.js";
import type {
  ResendAdapterConfig,
  ResendThreadId,
  ResendRawMessage,
} from "./types.js";

// Error class (inline to avoid hard dep on @chat-adapter/shared at dev time)
class NotImplementedError extends Error {
  constructor(method: string) {
    super(`${method} is not supported by the Resend adapter`);
    this.name = "NotImplementedError";
  }
}

/**
 * Vercel Chat SDK adapter for Resend email.
 * Implements Adapter<ResendThreadId, ResendRawMessage>.
 */
export class ResendAdapter {
  readonly name = "resend";
  readonly userName: string;

  private resend!: Resend;
  private chat: any; // ChatInstance — typed as any to avoid hard dep
  private threadResolver: ThreadResolver;
  private webhookHandler!: WebhookHandler;
  private formatConverter: ResendFormatConverter;
  private config: ResendAdapterConfig;

  constructor(config: ResendAdapterConfig) {
    this.config = config;
    this.userName = config.fromAddress;
    this.threadResolver = new ThreadResolver();
    this.formatConverter = new ResendFormatConverter();
  }

  async initialize(chat: any): Promise<void> {
    this.chat = chat;
    const apiKey = this.config.apiKey || process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error("Resend API key is required (config.apiKey or RESEND_API_KEY env)");
    }
    this.resend = new Resend(apiKey);

    const webhookSecret = this.config.webhookSecret || process.env.RESEND_WEBHOOK_SECRET || "";
    this.webhookHandler = new WebhookHandler(this.resend, webhookSecret);
  }

  encodeThreadId(id: ResendThreadId): string {
    return this.threadResolver.encodeThreadId(id);
  }

  decodeThreadId(threadId: string): ResendThreadId {
    return this.threadResolver.decodeThreadId(threadId);
  }

  async handleWebhook(request: Request): Promise<Response> {
    const result = await this.webhookHandler.parseWebhookRequest(request);

    if (result.status === 401) {
      return new Response("Unauthorized", { status: 401 });
    }

    if (!result.event) {
      return new Response("OK", { status: 200 });
    }

    const event = result.event;

    // Fetch full email content
    const email = await this.webhookHandler.fetchEmailContent(event.data.email_id);

    // Resolve thread
    const inReplyTo = email.headers?.["In-Reply-To"] || email.headers?.["in-reply-to"];
    const references = email.headers?.["References"] || email.headers?.["references"];
    const toAddress = parseEmailAddress(email.to[0]);

    const threadId = await this.threadResolver.resolveThreadId({
      toAddress,
      messageId: email.message_id,
      inReplyTo,
      references,
    });

    // Parse message
    const parsed = parseInboundEmail(email, threadId);

    // Fire-and-forget to Chat SDK
    this.chat.processMessage(this, threadId, {
      id: parsed.id,
      threadId: parsed.threadId,
      text: parsed.text,
      author: parsed.author,
      isMention: true,
      raw: parsed.raw,
      metadata: parsed.metadata,
    });

    return new Response("OK", { status: 200 });
  }

  async postMessage(
    threadId: string,
    message: { text?: string; formatted?: any; card?: any },
  ): Promise<{ id: string; raw: ResendRawMessage; threadId: string }> {
    const decoded = this.decodeThreadId(threadId);
    const rendered = await renderMessage(message);

    const fromDisplay = this.config.fromName
      ? `${this.config.fromName} <${this.config.fromAddress}>`
      : this.config.fromAddress;

    const messageId = generateMessageId(this.config.fromAddress);

    // Build reply headers if thread has history
    const headers: Record<string, string> = {
      "Message-ID": messageId,
    };

    // Determine subject
    const subject = `Email from ${this.config.fromName || this.config.fromAddress}`;

    const sendResult = await this.resend.emails.send({
      from: fromDisplay,
      to: [decoded.toAddress],
      subject,
      html: rendered.html,
      text: rendered.text,
      headers,
    });

    const sentId = (sendResult as any).data?.id || (sendResult as any).id || "unknown";

    // Track this message in the thread
    this.threadResolver.trackMessage(threadId, messageId);

    const raw: ResendRawMessage = {
      id: sentId,
      messageId,
      from: this.config.fromAddress,
      to: [decoded.toAddress],
      subject,
      text: rendered.text,
      html: rendered.html,
      headers,
      createdAt: new Date().toISOString(),
    };

    return { id: sentId, raw, threadId };
  }

  async editMessage(
    _threadId: string,
    _messageId: string,
    _message: any,
  ): Promise<any> {
    throw new NotImplementedError("editMessage");
  }

  async deleteMessage(_threadId: string, _messageId: string): Promise<void> {
    throw new NotImplementedError("deleteMessage");
  }

  async addReaction(
    _threadId: string,
    _messageId: string,
    _emoji: string,
  ): Promise<void> {
    throw new NotImplementedError("addReaction");
  }

  async removeReaction(
    _threadId: string,
    _messageId: string,
    _emoji: string,
  ): Promise<void> {
    throw new NotImplementedError("removeReaction");
  }

  async startTyping(_threadId: string): Promise<void> {
    throw new NotImplementedError("startTyping");
  }

  async fetchMessages(
    _threadId: string,
    _options?: any,
  ): Promise<{ messages: any[]; hasMore: boolean }> {
    // Minimal implementation — Resend receiving API doesn't support listing by thread
    return { messages: [], hasMore: false };
  }

  async fetchThread(threadId: string): Promise<{ id: string; title: string }> {
    const decoded = this.decodeThreadId(threadId);
    return { id: threadId, title: `Email thread with ${decoded.toAddress}` };
  }

  parseMessage(raw: ResendRawMessage): any {
    return {
      id: raw.id,
      text: raw.text || "",
      author: {
        id: parseEmailAddress(raw.from),
        name: raw.from,
        isBot: raw.from === this.config.fromAddress,
      },
      raw,
    };
  }

  renderFormatted(content: any): string {
    return this.formatConverter.fromAst(content);
  }

  // Optional: openDM
  async openDM(emailAddress: string): Promise<string> {
    const messageId = generateMessageId(this.config.fromAddress);
    const hash = await hashMessageId(messageId);
    const threadId = this.encodeThreadId({
      toAddress: parseEmailAddress(emailAddress),
      rootMessageIdHash: hash,
    });
    this.threadResolver.trackMessage(threadId, messageId);
    return threadId;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run test/adapter.test.ts`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: add adapter core (all interface methods)"
```

---

### Task 12: Factory + Exports

**Files:**
- Modify: `src/index.ts`

**Step 1: Update `src/index.ts`**

```typescript
// @chat-adapter/resend
export { ResendAdapter } from "./adapter.js";
export { ResendFormatConverter } from "./format-converter.js";
export { ThreadResolver } from "./thread-resolver.js";
export { renderCard } from "./card-renderer.js";
export { renderMessage } from "./message-renderer.js";
export { parseInboundEmail } from "./message-parser.js";
export { hashMessageId, parseEmailAddress, generateMessageId } from "./utils.js";

export type {
  ResendThreadId,
  ResendRawMessage,
  ResendAttachment,
  ResendAdapterConfig,
  ResendWebhookPayload,
  ResendReceivedEmail,
} from "./types.js";

import { ResendAdapter } from "./adapter.js";
import type { ResendAdapterConfig } from "./types.js";

/**
 * Create a new Resend adapter instance.
 * Reads config + env vars (RESEND_API_KEY, RESEND_WEBHOOK_SECRET).
 */
export function createResendAdapter(config: ResendAdapterConfig): ResendAdapter {
  return new ResendAdapter(config);
}
```

**Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add -A && git commit -m "feat: add factory function and public exports"
```

---

### Task 13: Build Verification

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

**Step 2: Run TypeScript build**

Run: `npx tsc`
Expected: Clean build, `dist/` created with `.js` and `.d.ts` files.

**Step 3: Verify dist output**

Run: `ls dist/`
Expected: `index.js`, `index.d.ts`, `adapter.js`, `adapter.d.ts`, etc.

**Step 4: Final commit**

```bash
git add -A && git commit -m "chore: verify build output"
```

---

## Dependency Install Order

Before starting Task 1, run:
```bash
npm install
```

Before Task 5 (format converter), add mdast deps:
```bash
npm install mdast-util-to-hast hast-util-to-html
npm install -D @types/mdast @types/hast
```

Before Task 6 (card renderer), add react deps:
```bash
npm install -D react @types/react
```

## Notes for Implementer

- The `chat` and `@chat-adapter/shared` packages are peer deps. They may not be published on npm yet. If `npm install` fails for these, create minimal type stubs in `src/stubs/` and adjust imports.
- The Resend SDK types may differ slightly from what's documented. Check `node_modules/resend/dist/index.d.ts` after install.
- The `resend.webhooks.verify()` API signature may use positional args `(body, headers)` instead of an options object — verify after install.
- All `.tsx` files need the JSX transform configured in `tsconfig.json` (already included in scaffold).
