import { and, desc, eq, ne } from "drizzle-orm";
import { activitiesTable, casesTable, clientsTable, db, propertiesTable } from "@workspace/db";
import { getClientOnboarding } from "./client-onboarding";
import { getAdviceRow, latestApproval, type CaseRow } from "./case-advice";
import { needsAdvice, serviceTypeLabel } from "./service-types";
import { stageName } from "./stages";

export interface SubmissionField {
  key: string;
  label: string;
  value: string | null;
  source: "client" | "property" | "case" | "advice";
  missing: boolean;
}
export interface SubmissionSection {
  key: string;
  title: string;
  fields: SubmissionField[];
}
export interface SubmissionPack {
  sections: SubmissionSection[];
  /** Labels of required fields that are still empty. */
  missing: string[];
}

const money = (value: number | null | undefined) =>
  value == null || value === 0 ? null : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(value);
const text = (value: string | null | undefined) => (value && value.trim() ? value.trim() : null);
const title = (value: string | null | undefined) => (value ? value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : null);
const date = (value: string | null | undefined) => (value ? new Date(value).toLocaleDateString("en-GB") : null);

/**
 * Scope step 7: the structured pack of everything that goes to the lender,
 * built from the client, property, case and advice records. `missing` is the
 * server-side version of the Add page readiness checks and gates Submission.
 */
export async function buildSubmissionPack(caseRow: CaseRow): Promise<SubmissionPack> {
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, caseRow.clientId));
  const [property] = caseRow.propertyId
    ? await db.select().from(propertiesTable).where(eq(propertiesTable.id, caseRow.propertyId))
    : [];
  const advice = await getAdviceRow(caseRow.id);
  const onboarding = client ? await getClientOnboarding(client.id) : null;
  const outstanding = onboarding ? onboarding.total - onboarding.completed : 0;

  const field = (
    key: string,
    label: string,
    value: string | null,
    source: SubmissionField["source"],
    required = true,
  ): SubmissionField => ({ key, label, value, source, missing: required && !value });

  const isLet = property?.occupancy === "let" || property?.occupancy === "holiday_let";
  const wantsRent = property?.matterType === "btl" || isLet;

  const sections: SubmissionSection[] = [
    {
      key: "applicant",
      title: "Applicant",
      fields: [
        field("name", "Full name", text(client?.name), "client"),
        field("email", "Email", text(client?.email), "client"),
        field("phone", "Phone", text(client?.phone), "client"),
        field("dateOfBirth", "Date of birth", date(client?.dateOfBirth), "client"),
        field("currentAddress", "Current address", text(client?.currentAddress), "client"),
        field("employmentStatus", "Employment status", title(client?.employmentStatus), "client"),
        field("employerName", "Employer", text(client?.employerName), "client", false),
        field("annualIncome", "Annual income", money(client?.annualIncome), "client"),
        field("otherIncome", "Other income", money(client?.otherIncome), "client", false),
        field("monthlyCommitments", "Monthly commitments", money(client?.monthlyCommitments), "client", false),
        field("creditHistoryNotes", "Credit history", text(client?.creditHistoryNotes), "client", false),
        field("companyName", "Company", text(client?.companyName), "client", false),
        field("onboarding", "Onboarding documents", outstanding === 0 ? "Complete" : `${outstanding} item${outstanding === 1 ? "" : "s"} outstanding`, "client"),
      ],
    },
    {
      key: "property",
      title: "Property",
      fields: [
        field("address", "Address", text(property?.address ?? caseRow.propertyAddress), "property"),
        field("propertyType", "Property type", title(property?.propertyType), "property"),
        field("tenure", "Tenure", title(property?.tenure), "property"),
        field("occupancy", "Occupancy", title(property?.occupancy), "property"),
        field("value", "Property value", money(property?.value ?? caseRow.propertyValue), "property"),
        field("rent", "Rental income", property?.rent ? `${money(property.rent)}/mo` : null, "property", !!wantsRent),
        field("purchasePrice", "Purchase price", money(property?.purchasePrice), "property", false),
      ],
    },
    {
      key: "mortgage",
      title: "Mortgage",
      fields: [
        field("matterType", "Matter", title(caseRow.matterType), "case"),
        field("serviceType", "Service level", serviceTypeLabel(caseRow.serviceType), "case"),
        field("basis", "Basis", await basisText(caseRow), needsAdvice(caseRow.serviceType) ? "advice" : "case"),
        field("loanAmount", "Loan amount", money(caseRow.loanAmount), "case"),
        field("lender", "Lender", await lenderName(advice?.lenderId ?? caseRow.lenderId), advice?.lenderId ? "advice" : "case", false),
        field("product", "Product", text(advice?.product), "advice", false),
        field("term", "Term", advice?.termYears != null ? `${advice.termYears} years` : null, "advice", false),
        field("ourFee", "Our fee", feeText(caseRow), "case"),
        field("assignedTo", "Case handler", text(caseRow.assignedTo), "case"),
      ],
    },
  ];
  // Onboarding counts as one requirement, so the client-side "n items outstanding" reads the same here.
  const missing = sections.flatMap((section) => section.fields.filter((item) => item.missing).map((item) =>
    item.key === "onboarding" ? `Onboarding: ${item.value?.toLowerCase() ?? "outstanding"}` : item.label));
  // Value / loan must be positive numbers, matching the Add page checks.
  if (caseRow.loanAmount <= 0 && !missing.includes("Loan amount")) missing.push("Loan amount");
  return { sections, missing };
}

/** "Adviser's recommendation — approved 16 Sep 2026" or "Client's own instruction (execution only)". */
async function basisText(caseRow: CaseRow) {
  if (!needsAdvice(caseRow.serviceType)) return "Client's own instruction (execution only)";
  const approval = await latestApproval(caseRow.id, "advice");
  if (approval?.response === "approved" && approval.respondedAt) {
    return `Adviser's recommendation — approved ${approval.respondedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
  }
  return approval ? "Adviser's recommendation — awaiting the client's approval" : "Adviser's recommendation — not yet sent";
}

/** The fee agreed under the Terms of Business, as the client will see it. */
function feeText(caseRow: CaseRow) {
  if (caseRow.brokerFeeBasis === "flat") return caseRow.brokerFeeFlat ? `${money(caseRow.brokerFeeFlat)} flat` : null;
  if (!caseRow.brokerFeePct) return null;
  const amount = money((caseRow.loanAmount * caseRow.brokerFeePct) / 100);
  return `${caseRow.brokerFeePct}% of the loan${amount ? ` (${amount})` : ""}`;
}

async function lenderName(lenderId: number | null | undefined) {
  if (!lenderId) return null;
  const { lendersTable } = await import("@workspace/db");
  const [lender] = await db.select({ name: lendersTable.name }).from(lendersTable).where(eq(lendersTable.id, lenderId));
  return lender?.name ?? null;
}

/** The client's most recent other case, completed ones first. */
export async function previousCaseFor(caseRow: CaseRow) {
  const rows = await db
    .select()
    .from(casesTable)
    .where(and(eq(casesTable.clientId, caseRow.clientId), ne(casesTable.id, caseRow.id)))
    .orderBy(desc(casesTable.updatedAt))
    .limit(10);
  return rows.find((row) => row.status === "completed") ?? rows[0] ?? null;
}

/**
 * Copy still-empty details from the previous case: the client's employment
 * and income, the case's lender and fees, and — when it is the same address —
 * the property's type, tenure and occupancy. Filled fields are never touched.
 */
export async function prefillFromPrevious(caseRow: CaseRow, actor: { displayName: string }) {
  const previous = await previousCaseFor(caseRow);
  if (!previous) return null;
  const copied: string[] = [];

  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, caseRow.clientId));
  if (client) {
    // Client fields live on the client row already; nothing to copy between cases.
    // (Kept here so the response can say so when a repeat client's profile is complete.)
  }

  const caseSet: Partial<typeof casesTable.$inferInsert> = {};
  if (!caseRow.lenderId && previous.lenderId) { caseSet.lenderId = previous.lenderId; copied.push("Lender"); }
  if (caseRow.procFeePct === 1 && previous.procFeePct !== 1) { caseSet.procFeePct = previous.procFeePct; copied.push("Proc fee %"); }
  if (caseRow.brokerFeePct === 0.5 && previous.brokerFeePct !== 0.5) { caseSet.brokerFeePct = previous.brokerFeePct; copied.push("Broker fee %"); }
  if (Object.keys(caseSet).length) {
    await db.update(casesTable).set(caseSet).where(eq(casesTable.id, caseRow.id));
  }

  const [property] = caseRow.propertyId ? await db.select().from(propertiesTable).where(eq(propertiesTable.id, caseRow.propertyId)) : [];
  const [previousProperty] = previous.propertyId ? await db.select().from(propertiesTable).where(eq(propertiesTable.id, previous.propertyId)) : [];
  if (property && previousProperty && property.id !== previousProperty.id
    && property.address.trim().toLowerCase() === previousProperty.address.trim().toLowerCase()) {
    const propertySet: Partial<typeof propertiesTable.$inferInsert> = {};
    if (!property.propertyType && previousProperty.propertyType) { propertySet.propertyType = previousProperty.propertyType; copied.push("Property type"); }
    if (!property.tenure && previousProperty.tenure) { propertySet.tenure = previousProperty.tenure; copied.push("Tenure"); }
    if (!property.occupancy && previousProperty.occupancy) { propertySet.occupancy = previousProperty.occupancy; copied.push("Occupancy"); }
    if (property.bedrooms == null && previousProperty.bedrooms != null) { propertySet.bedrooms = previousProperty.bedrooms; copied.push("Bedrooms"); }
    if (!property.epcRating && previousProperty.epcRating) { propertySet.epcRating = previousProperty.epcRating; copied.push("EPC rating"); }
    if (Object.keys(propertySet).length) {
      await db.update(propertiesTable).set(propertySet).where(eq(propertiesTable.id, property.id));
    }
  }

  const previousAdvice = await getAdviceRow(previous.id);
  const advice = await getAdviceRow(caseRow.id);
  if (previousAdvice && !advice?.lenderId && !advice?.product) {
    const { caseAdviceTable } = await import("@workspace/db");
    const values = { lenderId: previousAdvice.lenderId, product: previousAdvice.product, termYears: previousAdvice.termYears };
    if (advice) await db.update(caseAdviceTable).set(values).where(eq(caseAdviceTable.id, advice.id));
    else await db.insert(caseAdviceTable).values({ caseId: caseRow.id, ...values });
    copied.push("Previous lender & product (as a starting point for the advice)");
  }

  const fromReference = previous.displayReference || previous.reference;
  await db.update(casesTable).set({
    draftNotes: `${caseRow.draftNotes ? `${caseRow.draftNotes}\n\n` : ""}Prefilled from ${fromReference}: ${copied.length ? copied.join(", ") : "nothing was empty"}.`,
  }).where(eq(casesTable.id, caseRow.id));
  await db.insert(activitiesTable).values({
    caseId: caseRow.id,
    title: "Details prefilled from previous case",
    detail: `${caseRow.displayReference || caseRow.reference}: ${copied.length ? copied.join(", ") : "nothing to copy"} (from ${fromReference})`,
    actorName: actor.displayName,
  });
  return { copied, fromReference };
}

/** Everything the stage-1 panel needs: the pack itself and where a prefill could come from. */
export async function submissionDetailsState(caseRow: CaseRow) {
  const pack = await buildSubmissionPack(caseRow);
  const previous = await previousCaseFor(caseRow);
  return {
    pack,
    previousCase: previous
      ? { id: previous.id, reference: previous.displayReference || previous.reference, stage: stageName(previous.stageIndex), updatedAt: previous.updatedAt.toISOString() }
      : null,
  };
}
