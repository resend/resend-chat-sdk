import type { Resend } from "resend";
import type {
  ResendInboxEmail,
  ResendInboxWebhookPayload,
  ResendReceivedEmail,
  ResendWebhookPayload,
} from "./types.js";

interface WebhookResult {
  event: ResendWebhookPayload | ResendInboxWebhookPayload | null;
  status: number;
}

export class WebhookHandler {
  constructor(
    private readonly resend: Resend,
    private readonly webhookSecret: string,
    private readonly inboxId?: string
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

    if (this.inboxId) {
      const data = payload.data as { inbox_id?: string } | undefined;
      if (
        payload.type !== "inbox.email.received" ||
        data?.inbox_id !== this.inboxId
      ) {
        return { status: 200, event: null };
      }
      return {
        status: 200,
        event: payload as unknown as ResendInboxWebhookPayload,
      };
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
    if (response.error || !response.data) {
      throw new Error(
        `Failed to fetch email content: ${response.error?.message || "Unknown error"}`
      );
    }
    return response.data as unknown as ResendReceivedEmail;
  }

  async fetchInboxEmail(input: {
    emailId: string;
    inboxId: string;
    threadId: string;
  }): Promise<ResendInboxEmail> {
    const response = await this.resend.inboxes.threads.emails.get(input);
    if (response.error || !response.data) {
      throw new Error(
        `Failed to fetch inbox email: ${response.error?.message || "Unknown error"}`
      );
    }
    return response.data;
  }
}
