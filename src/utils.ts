import { createHash, randomUUID } from "node:crypto";

export async function hashMessageId(messageId: string): Promise<string> {
  const hash = createHash("sha256").update(messageId).digest("hex");
  return hash.slice(0, 16);
}

export function parseEmailAddress(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/<([^>]+)>/);
  const email = match ? match[1] : trimmed;
  return email.toLowerCase();
}

export function generateMessageId(fromAddress: string): string {
  const domain = fromAddress.split("@")[1] || "resend.dev";
  const unique = randomUUID();
  return `<${unique}@${domain}>`;
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim();
}
