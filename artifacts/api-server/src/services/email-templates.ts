import { eq } from "drizzle-orm";
import { appUsersTable, db, emailTemplatesTable } from "@workspace/db";

export const EMAIL_TEMPLATE_KEYS = ["client_welcome", "advice_email"] as const;
export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

export interface EmailTemplateText {
  subject: string;
  heading: string;
  /** Plain text; blank lines separate paragraphs. */
  body: string;
}

/** Values a template can reference as {{token}}. Each key adds its own on top of the base set. */
export type TemplateVars = Record<string, string>;

const BASE_PLACEHOLDERS = [
  { token: "firstName", description: "The client's first name" },
  { token: "name", description: "The client's full name" },
  { token: "company", description: "Their company, if any" },
  { token: "email", description: "The address the email is sent to" },
  { token: "sender", description: "The staff member sending it" },
];

export const TEMPLATE_PLACEHOLDERS: Record<EmailTemplateKey, Array<{ token: string; description: string }>> = {
  client_welcome: BASE_PLACEHOLDERS,
  advice_email: [
    ...BASE_PLACEHOLDERS,
    { token: "reference", description: "The case reference" },
    { token: "lender", description: "Recommended lender" },
    { token: "product", description: "Recommended product" },
    { token: "rate", description: "Rate, e.g. 4.85%" },
    { token: "term", description: "Term in years" },
    { token: "monthlyPayment", description: "Monthly payment" },
    { token: "summary", description: "The adviser's written recommendation" },
  ],
};

/** Built-in text, used until someone saves their own. */
export const DEFAULT_TEMPLATES: Record<EmailTemplateKey, EmailTemplateText> = {
  client_welcome: {
    subject: "Welcome to Chariot — set up your client portal",
    heading: "Welcome to Chariot",
    body: [
      "Dear {{firstName}},",
      "Thank you for your enquiry. A client portal has been created for you, giving you secure access to your case progress, documents and invoices. Please use the button below to set your password and activate your account.",
      "Once you are in, please upload the documents listed under Required information. We will send you our Terms of Business to sign electronically once your case is set up.",
      "For security, the link expires in 24 hours. If you have any questions, just reply to your case handler.",
    ].join("\n\n"),
  },
  advice_email: {
    subject: "Our mortgage recommendation — {{reference}}",
    heading: "Our recommendation for you",
    body: [
      "Dear {{firstName}},",
      "Having reviewed your circumstances, we recommend the following mortgage. The details are set out below.",
      "If you are happy to proceed, please click Approve. If you would like to talk anything through first, click Further discussion and we will come back to you.",
    ].join("\n\n"),
  },
};

/** Sample values for the key-specific placeholders, used by the template preview. */
export const SAMPLE_VARS: Record<EmailTemplateKey, TemplateVars> = {
  client_welcome: {},
  advice_email: {
    reference: "CH-2026-A1B2C3",
    lender: "Aldgate Bank",
    product: "5-year fixed, 75% LTV",
    rate: "4.85%",
    term: "25 years",
    monthlyPayment: "£1,214",
    summary: "A five-year fix gives you certainty on payments while rates settle, and Aldgate's product has no early-repayment penalty after year three.",
  },
};

export function isEmailTemplateKey(value: string): value is EmailTemplateKey {
  return (EMAIL_TEMPLATE_KEYS as readonly string[]).includes(value);
}

/** Stored text for a key, or the default when nothing has been saved. */
export async function getEmailTemplate(key: EmailTemplateKey) {
  const [row] = await db
    .select({
      subject: emailTemplatesTable.subject,
      heading: emailTemplatesTable.heading,
      body: emailTemplatesTable.body,
      updatedAt: emailTemplatesTable.updatedAt,
      updatedBy: appUsersTable.displayName,
    })
    .from(emailTemplatesTable)
    .leftJoin(appUsersTable, eq(emailTemplatesTable.updatedByUserId, appUsersTable.id))
    .where(eq(emailTemplatesTable.key, key));
  if (!row) {
    return { key, ...DEFAULT_TEMPLATES[key], isDefault: true, updatedAt: null, updatedBy: null };
  }
  return {
    key,
    subject: row.subject,
    heading: row.heading,
    body: row.body,
    isDefault: false,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy ?? null,
  };
}

export async function saveEmailTemplate(key: EmailTemplateKey, text: EmailTemplateText, userId: number) {
  await db
    .insert(emailTemplatesTable)
    .values({ key, ...text, updatedByUserId: userId })
    .onConflictDoUpdate({
      target: emailTemplatesTable.key,
      set: { ...text, updatedByUserId: userId, updatedAt: new Date() },
    });
  return getEmailTemplate(key);
}

export async function resetEmailTemplate(key: EmailTemplateKey) {
  await db.delete(emailTemplatesTable).where(eq(emailTemplatesTable.key, key));
  return getEmailTemplate(key);
}

export function templateVarsFor(client: { name: string; email: string; companyName?: string | null }, sender: string): TemplateVars {
  return {
    name: client.name,
    firstName: client.name.trim().split(/\s+/)[0] || client.name,
    email: client.email,
    company: client.companyName ?? "",
    sender,
  };
}

export const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function substitute(text: string, vars: TemplateVars) {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, token: string) =>
    token in vars ? vars[token]! : match,
  );
}

/**
 * Turn the stored text into what the branded shell needs: a subject line,
 * a heading and escaped HTML paragraphs (single line breaks inside a
 * paragraph become <br>). Text is escaped — the template can never inject markup.
 */
export function renderEmailTemplate(text: EmailTemplateText, vars: TemplateVars) {
  const paragraphs = substitute(text.body, vars)
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => escapeHtml(paragraph).replace(/\n/g, "<br />"));
  return {
    subject: substitute(text.subject, vars).trim(),
    heading: escapeHtml(substitute(text.heading, vars).trim()),
    paragraphs,
  };
}
