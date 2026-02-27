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
