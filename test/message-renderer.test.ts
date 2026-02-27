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
