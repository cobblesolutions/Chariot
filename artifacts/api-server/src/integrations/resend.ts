export type EmailPurpose =
  | "portal_activation"
  | "password_reset"
  | "client_welcome"
  | "onboarding_reminder"
  | "onboarding_complete"
  | "advice_approval"
  | "advice_email"
  | "details_confirmation"
  | "valuation_reminder"
  | "underwriting_requirements"
  | "lender_offer"
  | "invoice"
  | "task_assignment"
  | "daily_task_digest"
  | "renewal_reminder";

export interface EmailRequest {
  purpose: EmailPurpose;
  to: string[];
  subject: string;
  html: string;
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    content: string;
  }>;
}

export interface EmailResult {
  status: "disabled" | "sent";
  providerId?: string;
}

/**
 * All chariot.co.uk addresses are synthetic demo/test mailboxes. They must
 * never be passed to Resend, including staff addresses used by task and
 * reminder jobs.
 */
function isSyntheticChariotAddress(address: string) {
  return /@chariot\.co\.uk$/i.test(address.trim());
}

/**
 * The Resend transport is intentionally fail-closed. Connecting Resend does not
 * activate delivery; production email only begins when RESEND_ACTIVE is true
 * and a verified sender has been configured.
 */
export async function sendChariotEmail(
  request: EmailRequest,
): Promise<EmailResult> {
  const recipients = request.to.filter((address) => !isSyntheticChariotAddress(address));
  if (recipients.length === 0) {
    return { status: "disabled" };
  }
  if (process.env.RESEND_ACTIVE !== "true") {
    return { status: "disabled" };
  }
  // Chariot's verified transactional sender.  Keeping this fixed prevents a
  // deployment variable from accidentally impersonating another mailbox.
  const from = "Chariot <no-reply@webrixstudios.dev>";
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is required when Resend is active");
  }
  // Keep internal email-purpose labels in Resend tags only. Older callers or
  // an already-running build may still pass subjects such as
  // "[password_reset] Reset your Chariot password"; never expose that
  // implementation label to recipients.
  const subject = request.subject.replace(/^\[[^\]]+\]\s*/, "");
  const replyTo = request.replyTo && !isSyntheticChariotAddress(request.replyTo)
    ? request.replyTo
    : undefined;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: recipients,
      subject,
      html: request.html,
      reply_to: replyTo,
      attachments: request.attachments,
      tags: [{ name: "purpose", value: request.purpose }],
    }),
  });
  if (!response.ok) {
    throw new Error(`Resend delivery failed with status ${response.status}`);
  }
  const payload = (await response.json()) as { id?: string };
  return { status: "sent", providerId: payload.id };
}
