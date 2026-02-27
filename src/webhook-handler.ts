import type { Resend } from "resend";
import type { ResendWebhookPayload, ResendReceivedEmail } from "./types.js";

interface WebhookResult {
  status: number;
  event: ResendWebhookPayload | null;
}

export class WebhookHandler {
  constructor(
    private resend: Resend,
    private webhookSecret: string,
  ) {}

  async parseWebhookRequest(request: Request): Promise<WebhookResult> {
    const body = await request.text();
    const svixId = request.headers.get("svix-id") || "";
    const svixTimestamp = request.headers.get("svix-timestamp") || "";
    const svixSignature = request.headers.get("svix-signature") || "";

    let payload: Record<string, unknown>;
    try {
      payload = this.resend.webhooks.verify({
        payload: body,
        headers: {
          id: svixId,
          timestamp: svixTimestamp,
          signature: svixSignature,
        },
        webhookSecret: this.webhookSecret,
      }) as unknown as Record<string, unknown>;
    } catch {
      return { status: 401, event: null };
    }

    if (payload.type !== "email.received") {
      return { status: 200, event: null };
    }

    return {
      status: 200,
      event: payload as unknown as ResendWebhookPayload,
    };
  }

  async fetchEmailContent(emailId: string): Promise<ResendReceivedEmail> {
    const response = await this.resend.emails.receiving.get(emailId);
    return response.data as unknown as ResendReceivedEmail;
  }
}
