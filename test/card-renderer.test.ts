import { describe, expect, it } from "vitest";
import { renderCard } from "../src/card-renderer.js";

describe("renderCard", () => {
  it("renders a card with title, subtitle, and text", async () => {
    const card = {
      type: "card",
      title: "Welcome",
      subtitle: "Thanks for reaching out",
      children: [{ type: "text", content: "Hello world" }],
    };
    const html = await renderCard(card);
    expect(html).toContain("Welcome");
    expect(html).toContain("Thanks for reaching out");
    expect(html).toContain("Hello world");
  });

  it("renders a link-button with URL", async () => {
    const card = {
      type: "card",
      children: [
        {
          type: "actions",
          children: [
            {
              type: "link-button",
              label: "Click me",
              url: "https://example.com",
            },
          ],
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
          type: "image",
          label: "Test image",
          url: "https://example.com/img.png",
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
        { type: "text", content: "Before" },
        { type: "divider" },
        { type: "text", content: "After" },
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
          type: "link",
          label: "Example",
          url: "https://example.com",
        },
      ],
    };
    const html = await renderCard(card);
    expect(html).toContain("https://example.com");
    expect(html).toContain("Example");
  });

  it("renders a field", async () => {
    const card = {
      type: "card",
      children: [
        {
          type: "fields",
          children: [{ type: "field", label: "Status", value: "Open" }],
        },
      ],
    };
    const html = await renderCard(card);
    expect(html).toContain("Status");
    expect(html).toContain("Open");
  });

  it("renders the welcome-cards example card", async () => {
    const card = {
      type: "card",
      title: "Welcome!",
      subtitle: "Thanks for reaching out",
      children: [
        {
          type: "text",
          content: "Hi! Thanks for emailing us. We'll get back to you shortly.",
        },
        { type: "divider" },
        {
          type: "actions",
          children: [
            {
              type: "link-button",
              label: "Visit our website",
              url: "https://resend.com",
            },
          ],
        },
      ],
    };
    const html = await renderCard(card);
    expect(html).toContain("Welcome!");
    expect(html).toContain("Thanks for reaching out");
    expect(html).toContain("Hi! Thanks for emailing us");
    expect(html).toContain("https://resend.com");
    expect(html).toContain("Visit our website");
    expect(html.toLowerCase()).toContain("hr");
  });
});
