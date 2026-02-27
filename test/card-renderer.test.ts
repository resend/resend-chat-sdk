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
    // hr element should be present
    expect(html.toLowerCase()).toContain("hr");
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
