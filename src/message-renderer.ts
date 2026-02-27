import type { Root } from "mdast";
import type { CardNode } from "./card-renderer.js";
import { renderCard } from "./card-renderer.js";
import { ResendFormatConverter } from "./format-converter.js";
import { stripHtml } from "./utils.js";

interface RenderInput {
  card?: CardNode;
  formatted?: Root;
  text?: string;
}

interface RenderOutput {
  html: string;
  text: string;
}

const converter = new ResendFormatConverter();

export async function renderMessage(input: RenderInput): Promise<RenderOutput> {
  if (input.card) {
    const html = await renderCard(input.card);
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

function extractTextFromCard(card: CardNode): string {
  const parts: string[] = [];
  if (!card.children || typeof card.children === "string") {
    return typeof card.children === "string" ? card.children : "";
  }
  for (const child of card.children) {
    if (typeof child.children === "string") {
      parts.push(child.children);
    } else if (Array.isArray(child.children)) {
      parts.push(extractTextFromCard(child));
    }
  }
  return parts.join("\n");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
