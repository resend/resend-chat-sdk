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

export async function renderMessage(input: RenderInput): Promise<RenderOutput> {
  if (input.card) {
    const html = await renderCard(input.card as Parameters<typeof renderCard>[0]);
    const text = extractTextFromCard(input.card) || input.text || "";
    return { html, text };
  }

  if (input.formatted) {
    const html = converter.fromAst(input.formatted);
    const text = input.text || stripHtml(html);
    return { html, text };
  }

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
