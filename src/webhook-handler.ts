import type { InboxSelector, Resend } from "resend";
import type {
  ResendInboxDraftSentPayload,
  ResendInboxEmail,
  ResendInboxWebhookPayload,
  ResendReceivedEmail,
  ResendWebhookPayload,
  ResendWebhookVerifier,
} from "./types.js";

interface WebhookResult {
  event:
    | ResendWebhookPayload
    | ResendInboxWebhookPayload
    | ResendInboxDraftSentPayload
    | null;
  status: number;
}

export class WebhookHandler {
  private resolvedInboxId: Promise<string> | null = null;

  constructor(
    private readonly getResend: () => Promise<Resend>,
    private readonly webhookSecret: string,
    private readonly inbox?: InboxSelector,
    private readonly webhookVerifier?: ResendWebhookVerifier
  ) {}

  async parseWebhookRequest(request: Request): Promise<WebhookResult> {
    const body = await request.text();

    const payload = this.webhookVerifier
      ? await this.verifyWithVerifier(this.webhookVerifier, request, body)
      : this.verifySignature(await this.getResend(), request, body);
    if (!payload) {
      return { status: 401, event: null };
    }

    if (this.inbox) {
      if (
        payload.type !== "inbox.email.received" &&
        payload.type !== "inbox.draft.sent"
      ) {
        return { status: 200, event: null };
      }
      const data = payload.data as { inbox_id?: string } | undefined;
      if (data?.inbox_id !== (await this.getInboxId(this.inbox))) {
        return { status: 200, event: null };
      }
      return {
        status: 200,
        event: payload as unknown as
          | ResendInboxWebhookPayload
          | ResendInboxDraftSentPayload,
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

  /** Returns the payload, or `null` when the verifier rejects the request. */
  private async verifyWithVerifier(
    verifier: ResendWebhookVerifier,
    request: Request,
    body: string
  ): Promise<Record<string, unknown> | null> {
    try {
      if (!(await verifier(request, body))) {
        return null;
      }
      return JSON.parse(body) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /** Returns the payload, or `null` when the Svix signature is not valid. */
  private verifySignature(
    resend: Resend,
    request: Request,
    body: string
  ): Record<string, unknown> | null {
    try {
      return resend.webhooks.verify({
        payload: body,
        headers: {
          id: request.headers.get("svix-id") || "",
          timestamp: request.headers.get("svix-timestamp") || "",
          signature: request.headers.get("svix-signature") || "",
        },
        webhookSecret: this.webhookSecret,
      }) as unknown as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  getInboxId(inbox: InboxSelector): Promise<string> {
    if (inbox.inboxId !== undefined) {
      return Promise.resolve(inbox.inboxId);
    }
    if (!this.resolvedInboxId) {
      this.resolvedInboxId = this.fetchInboxId(inbox.emailAddress).catch(
        (error: unknown) => {
          this.resolvedInboxId = null;
          throw error;
        }
      );
    }
    return this.resolvedInboxId;
  }

  private async fetchInboxId(emailAddress: string): Promise<string> {
    const resend = await this.getResend();
    const response = await resend.inboxes.get(emailAddress);
    if (response.error?.statusCode === 404) {
      throw new Error(`Inbox ${emailAddress} does not exist`);
    }
    if (response.error || !response.data) {
      throw new Error(
        `Failed to get inbox ${emailAddress}: ${response.error?.message || "Unknown error"}`
      );
    }
    return response.data.id;
  }

  async fetchEmailContent(emailId: string): Promise<ResendReceivedEmail> {
    const resend = await this.getResend();
    const response = await resend.emails.receiving.get(emailId);
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
    const resend = await this.getResend();
    const response = await resend.inboxes.threads.emails.get(input);
    if (response.error || !response.data) {
      throw new Error(
        `Failed to fetch inbox email: ${response.error?.message || "Unknown error"}`
      );
    }
    return response.data;
  }
}
