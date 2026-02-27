import { toHtml } from "hast-util-to-html";
import type { Root, RootContent } from "mdast";
import { toHast } from "mdast-util-to-hast";

const PARAGRAPH_SPLIT_RE = /\n\n+/;

export class ResendFormatConverter {
  fromAst(ast: Root): string {
    const hast = toHast(ast);
    if (!hast) {
      return "";
    }
    return toHtml(hast);
  }

  toAst(text: string): Root {
    if (!text || text.trim() === "") {
      return { type: "root", children: [] };
    }

    const paragraphs = text.split(PARAGRAPH_SPLIT_RE);
    const children: RootContent[] = paragraphs
      .filter((p) => p.trim() !== "")
      .map((p) => ({
        type: "paragraph" as const,
        children: [{ type: "text" as const, value: p.trim() }],
      }));

    return { type: "root", children };
  }
}
