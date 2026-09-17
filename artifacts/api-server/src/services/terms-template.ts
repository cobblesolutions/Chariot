import { desc, eq, inArray } from "drizzle-orm";
import {
  appUsersTable,
  casesTable,
  clientsTable,
  db,
  termsOfBusinessTemplatesTable,
  TERMS_FIELD_TYPES,
  type TermsFieldType,
  type TermsTemplateField,
} from "@workspace/db";
import { logActivity } from "./activities";
import { serviceTypeLabel } from "./service-types";

export const FIRM_NAME = process.env.FIRM_NAME?.trim() || "Chariot";

type TemplateRow = typeof termsOfBusinessTemplatesTable.$inferSelect;
export type TermsTemplate = TemplateRow & { publishedBy: string | null };

export interface TermsTemplateInput {
  title: string;
  body: string;
  fields: TermsTemplateField[];
}

/**
 * Values the body can reference that come from the case and its client rather
 * than the form. They show in the form read-only so staff see what will print.
 */
export const AUTO_TOKENS = [
  { token: "clientName", group: "client", description: "The client's full name" },
  { token: "firstName", group: "client", description: "The client's first name" },
  { token: "clientEmail", group: "client", description: "The client's email address" },
  { token: "clientPhone", group: "client", description: "The client's phone number" },
  { token: "clientAddress", group: "client", description: "The client's current address" },
  { token: "companyName", group: "client", description: "Their company, if any (otherwise blank)" },
  { token: "caseReference", group: "case", description: "The case reference" },
  { token: "propertyAddress", group: "case", description: "The property the case is for" },
  { token: "matterType", group: "case", description: "The matter type, e.g. Buy to let" },
  { token: "loanAmount", group: "case", description: "The loan amount, e.g. £232,500" },
  { token: "propertyValue", group: "case", description: "The property value" },
  { token: "serviceLevel", group: "case", description: "The case's service level: Advised / Light advised / Execution only" },
  { token: "ourFee", group: "case", description: "The fee set on the case, e.g. “0.5% of the loan (£1,163)” or “£995 flat”" },
  { token: "adviser", group: "case", description: "The staff member handling the case" },
  { token: "firmName", group: "firm", description: `The firm's name (${FIRM_NAME})` },
  { token: "date", group: "firm", description: "The date the document is generated, e.g. 17 September 2026" },
  { token: "templateVersion", group: "firm", description: "The template version number" },
] as const;

export type AutoToken = (typeof AUTO_TOKENS)[number]["token"];

/** Built-in text, used until an administrator publishes their own. */
export const DEFAULT_TEMPLATE: TermsTemplateInput = {
  title: "Terms of Business",
  body: [
    "This document sets out the terms on which {{firmName}} will act for {{clientName}}{{companyNameClause}} in arranging finance of {{loanAmount}} secured on {{propertyAddress}} (our reference {{caseReference}}). Please read it carefully; by signing it you confirm that you have understood and accepted these terms.",
    "# Our service",
    "The service we will provide on this case is: {{serviceLevel}}.",
    "Where we advise, we will assess your requirements and recommend a product we consider suitable from the lenders we have access to. Where you instruct us on an execution-only basis you are choosing the product yourself and we will not give advice on its suitability.",
    "# Our fee",
    "Our fee for this service is {{ourFee}}, payable {{feePayable}}.",
    "{{procurationFee}}",
    "# Your responsibilities",
    "- Give us accurate and complete information about your circumstances and let us know promptly if anything changes.",
    "- Provide the documents we ask for within a reasonable time.",
    "- Tell us if you have any concerns about the service at any point.",
    "# Cancellation",
    "You may cancel this agreement at any time by giving us {{cancellationNotice}} days' notice in writing. Any fee already due for work carried out before cancellation remains payable.",
    "# Data protection",
    "We will use your personal information to arrange your finance, to meet our regulatory obligations and to keep you informed about your case. We will share it with lenders, valuers and solicitors only as needed to progress your application.",
    "# Complaints",
    "If you are unhappy with our service please tell {{adviser}} or write to us at {{firmName}}. We will acknowledge your complaint promptly and aim to resolve it within eight weeks.",
    "Issued on behalf of {{firmName}} by {{adviser}}, {{date}}.",
  ].join("\n\n"),
  fields: [
    {
      key: "feePayable",
      label: "Fee payable",
      type: "select",
      required: true,
      options: ["on completion", "on receipt of the mortgage offer", "on submission of the application"],
      defaultValue: "on completion",
    },
    {
      key: "procurationFee",
      label: "Lender commission wording",
      type: "textarea",
      required: false,
      defaultValue: "We may also receive a procuration fee from the lender when your mortgage completes. We will tell you the amount before you apply.",
      hint: "Leave blank to omit the paragraph.",
    },
    {
      key: "cancellationNotice",
      label: "Cancellation notice (days)",
      type: "number",
      required: true,
      defaultValue: "14",
    },
  ],
};

async function withPublishers(rows: TemplateRow[]): Promise<TermsTemplate[]> {
  const ids = [...new Set(rows.map((row) => row.publishedByUserId).filter((id): id is number => id != null))];
  const users = ids.length
    ? await db.select({ id: appUsersTable.id, displayName: appUsersTable.displayName }).from(appUsersTable).where(inArray(appUsersTable.id, ids))
    : [];
  const names = new Map(users.map((user) => [user.id, user.displayName]));
  return rows.map((row) => ({ ...row, publishedBy: row.publishedByUserId != null ? names.get(row.publishedByUserId) ?? null : null }));
}

/** Every published version, newest first. Versions are never deleted: an agreement records the one it came from. */
export async function listTermsTemplates() {
  return withPublishers(await db.select().from(termsOfBusinessTemplatesTable).orderBy(desc(termsOfBusinessTemplatesTable.version)));
}

/** A specific version, or the current (highest) one when none is given. Null until something is published. */
export async function getTermsTemplate(version?: number | null) {
  const [row] = version != null
    ? await db.select().from(termsOfBusinessTemplatesTable).where(eq(termsOfBusinessTemplatesTable.version, version))
    : await db.select().from(termsOfBusinessTemplatesTable).orderBy(desc(termsOfBusinessTemplatesTable.version)).limit(1);
  if (!row) return null;
  const [template] = await withPublishers([row]);
  return template ?? null;
}

export function termsTemplateView(template: TermsTemplate | null) {
  if (!template) return null;
  return {
    version: template.version,
    title: template.title,
    body: template.body,
    fields: template.fields,
    publishedAt: template.publishedAt.toISOString(),
    publishedBy: template.publishedBy,
  };
}

const KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const RESERVED = new Set<string>([...AUTO_TOKENS.map((item) => item.token), "companyNameClause"]);

/** Throws with a message fit for a 400 when the template cannot be published. */
export function validateTemplateInput(input: TermsTemplateInput): TermsTemplateInput {
  const title = input.title.trim();
  const body = input.body.replace(/\r\n/g, "\n").trim();
  if (!title) throw new Error("Give the document a title");
  if (!body) throw new Error("The template body is empty");
  const seen = new Set<string>();
  const fields = input.fields.map((field, index) => {
    const key = field.key.trim();
    const label = field.label.trim();
    if (!KEY_PATTERN.test(key)) throw new Error(`Field ${index + 1}: the key must be letters, digits and underscores, starting with a letter`);
    if (RESERVED.has(key)) throw new Error(`Field "${key}" clashes with a built-in token`);
    if (seen.has(key)) throw new Error(`Field key "${key}" is used twice`);
    seen.add(key);
    if (!label) throw new Error(`Field "${key}" needs a label`);
    if (!(TERMS_FIELD_TYPES as readonly string[]).includes(field.type)) throw new Error(`Field "${key}" has an unknown type`);
    const options = field.type === "select" ? (field.options ?? []).map((option) => option.trim()).filter(Boolean) : undefined;
    if (field.type === "select" && (!options || options.length === 0)) throw new Error(`Field "${key}" needs at least one option`);
    const defaultValue = field.defaultValue?.trim() || undefined;
    if (field.type === "select" && defaultValue && !options!.includes(defaultValue)) throw new Error(`Field "${key}": the default must be one of its options`);
    return {
      key,
      label,
      type: field.type as TermsFieldType,
      required: !!field.required,
      ...(options ? { options } : {}),
      ...(defaultValue ? { defaultValue } : {}),
      ...(field.hint?.trim() ? { hint: field.hint.trim() } : {}),
    } satisfies TermsTemplateField;
  });
  return { title, body, fields };
}

/** Publish a new version. Earlier versions stay (see listTermsTemplates). */
export async function publishTermsTemplate(input: TermsTemplateInput, userId: number, actorName: string) {
  const valid = validateTemplateInput(input);
  const current = await getTermsTemplate();
  const [row] = await db
    .insert(termsOfBusinessTemplatesTable)
    .values({ version: (current?.version ?? 0) + 1, ...valid, publishedByUserId: userId })
    .returning();
  await logActivity({
    kind: "terms",
    title: "Terms of Business template published",
    detail: `"${valid.title}" published as version ${row!.version} with ${valid.fields.length} field${valid.fields.length === 1 ? "" : "s"}`,
    actorName,
  });
  return getTermsTemplate(row!.version);
}

/** `{{token}}` occurrences in a body, in order of first appearance. */
export function tokensIn(body: string) {
  const found: string[] = [];
  for (const match of body.matchAll(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g)) {
    if (!found.includes(match[1]!)) found.push(match[1]!);
  }
  return found;
}

export function renderTemplateBody(body: string, values: Record<string, string>) {
  return body.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, (_match, token: string) => values[token] ?? "");
}

const longDate = (date: Date) => date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const money = (value: number | null | undefined) =>
  value == null ? "" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(value);
const title = (value: string) => value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export type CaseForTerms = Pick<
  typeof casesTable.$inferSelect,
  "id" | "reference" | "displayReference" | "propertyAddress" | "matterType" | "loanAmount" | "propertyValue" | "serviceType" | "brokerFeeBasis" | "brokerFeePct" | "brokerFeeFlat" | "assignedUserId" | "assignedTo"
>;
export type ClientForTerms = Pick<typeof clientsTable.$inferSelect, "id" | "name" | "email" | "phone" | "companyName" | "currentAddress" | "assignedUserId">;

/** The fee as it prints — the same wording the submission pack shows. */
export function feeText(caseRow: CaseForTerms) {
  if (caseRow.brokerFeeBasis === "flat") return caseRow.brokerFeeFlat ? `${money(caseRow.brokerFeeFlat)} flat` : "";
  if (!caseRow.brokerFeePct) return "";
  const amount = money((caseRow.loanAmount * caseRow.brokerFeePct) / 100);
  return `${caseRow.brokerFeePct}% of the loan${amount ? ` (${amount})` : ""}`;
}

/** The read-only values for a case — everything the body can use that staff do not type. */
export async function autoValuesFor(caseRow: CaseForTerms, client: ClientForTerms, templateVersion: number, now = new Date()): Promise<Record<AutoToken | "companyNameClause", string>> {
  const adviserId = caseRow.assignedUserId ?? client.assignedUserId;
  const [adviser] = adviserId
    ? await db.select({ displayName: appUsersTable.displayName }).from(appUsersTable).where(eq(appUsersTable.id, adviserId))
    : [];
  const company = client.companyName?.trim() ?? "";
  return {
    clientName: client.name,
    firstName: client.name.trim().split(/\s+/)[0] || client.name,
    clientEmail: client.email,
    clientPhone: client.phone ?? "",
    clientAddress: client.currentAddress?.trim() ?? "",
    companyName: company,
    companyNameClause: company ? ` (${company})` : "",
    caseReference: caseRow.displayReference?.trim() || caseRow.reference,
    propertyAddress: caseRow.propertyAddress,
    matterType: title(caseRow.matterType),
    loanAmount: money(caseRow.loanAmount),
    propertyValue: money(caseRow.propertyValue),
    serviceLevel: serviceTypeLabel(caseRow.serviceType),
    ourFee: feeText(caseRow),
    adviser: adviser?.displayName ?? caseRow.assignedTo?.trim() ?? "your adviser",
    firmName: FIRM_NAME,
    date: longDate(now),
    templateVersion: String(templateVersion),
  };
}

/** Sample values for the preview in Settings. */
export const SAMPLE_AUTO_VALUES: Record<AutoToken | "companyNameClause", string> = {
  clientName: "Nadia Okafor",
  firstName: "Nadia",
  clientEmail: "nadia.okafor@example.com",
  clientPhone: "07700 900123",
  clientAddress: "14 Elm Grove, Leeds LS6 2AB",
  companyName: "Okafor Property Ltd",
  companyNameClause: " (Okafor Property Ltd)",
  caseReference: "CH-2026-A1B2C3",
  propertyAddress: "27 Harcourt Road, Manchester M20 4QT",
  matterType: "Buy to let",
  loanAmount: "£232,500",
  propertyValue: "£310,000",
  serviceLevel: "Advised",
  ourFee: "0.5% of the loan (£1,163)",
  adviser: "Alex Morgan",
  firmName: FIRM_NAME,
  date: longDate(new Date()),
  templateVersion: "1",
};

/** Default value per field, for a new form or the preview. */
export function defaultFieldValues(fields: TermsTemplateField[]) {
  return Object.fromEntries(fields.map((field) => [field.key, field.defaultValue ?? (field.type === "select" ? field.options?.[0] ?? "" : "")]));
}

/** Sample values for the preview: defaults, with something plausible for each blank field. */
export function sampleFieldValues(fields: TermsTemplateField[]) {
  const values = defaultFieldValues(fields);
  for (const field of fields) {
    if (values[field.key]) continue;
    values[field.key] =
      field.type === "number" ? "10"
        : field.type === "currency" ? "£995"
          : field.type === "date" ? longDate(new Date())
            : `[${field.label}]`;
  }
  return values;
}

/** Keeps only the template's fields, trimmed; a select value must be one of its options. */
export function cleanFieldValues(fields: TermsTemplateField[], raw: Record<string, unknown>) {
  const values: Record<string, string> = {};
  for (const field of fields) {
    const value = raw[field.key];
    const text = typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
    if (field.type === "select" && text && !(field.options ?? []).includes(text)) {
      throw new Error(`${field.label}: choose one of the listed options`);
    }
    if (field.type === "number" && text && Number.isNaN(Number(text.replace(/,/g, "")))) {
      throw new Error(`${field.label}: enter a number`);
    }
    values[field.key] = text;
  }
  return values;
}

/** Labels of required fields still blank. */
export function missingFieldLabels(fields: TermsTemplateField[], values: Record<string, string>) {
  return fields.filter((field) => field.required && !values[field.key]?.trim()).map((field) => field.label);
}

/** Display formatting per type — what actually prints in the document. */
export function formatFieldValue(field: TermsTemplateField, value: string) {
  if (!value) return "";
  if (field.type === "currency") {
    const number = Number(value.replace(/[£,\s]/g, ""));
    return Number.isFinite(number) && /^[£\d,.\s]+$/.test(value) ? `£${number.toLocaleString("en-GB", { minimumFractionDigits: number % 1 ? 2 : 0, maximumFractionDigits: 2 })}` : value;
  }
  if (field.type === "date") {
    const date = new Date(value);
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(date.getTime()) ? longDate(date) : value;
  }
  return value;
}

/** Everything substituted into the body: auto values, then the formatted field values. */
export function mergedValues(fields: TermsTemplateField[], auto: Record<string, string>, values: Record<string, string>) {
  const merged: Record<string, string> = { ...auto };
  for (const field of fields) merged[field.key] = formatFieldValue(field, values[field.key] ?? "");
  return merged;
}
