import type { clientsTable } from "@workspace/db";
import type { DocumentReadingView } from "./index";
import type { BankStatementsReading } from "./readers/bank-statements";
import type { CreditReportReading } from "./readers/credit-report";
import type { IdentityReading } from "./readers/identity";
import type { ProofOfIncomeReading } from "./readers/proof-of-income";
import { normalisePostcode } from "./readers/shared";

export type CheckStatus = "ok" | "mismatch" | "attention" | "info";

/** One cross-document consistency finding shown on the Add page. */
export interface DocumentCheck {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

type ClientRow = typeof clientsTable.$inferSelect;
type ReadingByReader = Partial<{
  identity: IdentityReading;
  bank_statements: BankStatementsReading;
  proof_of_income: ProofOfIncomeReading;
  credit_report: CreditReportReading;
}>;

const money = (value: number) => `£${Math.round(value).toLocaleString("en-GB")}`;

/**
 * Compares what the documents say with each other and with the client record.
 * Only findings with something to say are returned: two sources that agree
 * (ok), disagree (mismatch), or a single document raising a flag (attention).
 */
export function documentChecks(client: ClientRow, readings: DocumentReadingView[]): DocumentCheck[] {
  const latest: ReadingByReader = {};
  for (const reading of readings) {
    if (reading.status !== "completed" || !reading.data) continue;
    (latest as Record<string, unknown>)[reading.reader] ??= reading.data;
  }
  const checks: DocumentCheck[] = [];
  const id = latest.identity;
  const bank = latest.bank_statements;
  const income = latest.proof_of_income;
  const credit = latest.credit_report;

  // Name on the ID vs the record.
  if (id?.fullName) {
    const same = sameName(id.fullName, client.name);
    checks.push({
      key: "name",
      label: "Name",
      status: same ? "ok" : "mismatch",
      detail: same ? `ID reads ${id.fullName}` : `ID reads "${id.fullName}", record says "${client.name}"`,
    });
  }

  // Date of birth: ID, credit report and the record must agree.
  const dobs = [
    id?.dateOfBirth ? { source: "ID", value: id.dateOfBirth } : null,
    credit?.dateOfBirth ? { source: "credit report", value: credit.dateOfBirth } : null,
    client.dateOfBirth ? { source: "record", value: client.dateOfBirth } : null,
  ].filter((entry): entry is { source: string; value: string } => !!entry);
  if (dobs.length >= 2) {
    const distinct = new Set(dobs.map((entry) => entry.value));
    checks.push({
      key: "dob",
      label: "Date of birth",
      status: distinct.size === 1 ? "ok" : "mismatch",
      detail: distinct.size === 1 ? `${dobs[0]!.value} on ${dobs.map((entry) => entry.source).join(", ")}` : dobs.map((entry) => `${entry.source} ${entry.value}`).join(" · "),
    });
  }

  // Current address: any document with a postcode vs the record.
  const postcodes = [
    id?.postcode ? { source: "driving licence", value: normalisePostcode(id.postcode) } : null,
    bank?.postcode ? { source: "bank statement", value: normalisePostcode(bank.postcode) } : null,
    credit?.addresses.find((entry) => entry.current)?.postcode ? { source: "credit report", value: normalisePostcode(credit.addresses.find((entry) => entry.current)!.postcode) } : null,
    client.currentAddressPostcode ? { source: "record", value: normalisePostcode(client.currentAddressPostcode) } : null,
  ].filter((entry): entry is { source: string; value: string } => !!entry && !!entry.value);
  if (postcodes.length >= 2) {
    const distinct = new Set(postcodes.map((entry) => entry.value));
    checks.push({
      key: "address",
      label: "Current address",
      status: distinct.size === 1 ? "ok" : "mismatch",
      detail: distinct.size === 1 ? `${postcodes[0]!.value} on ${postcodes.map((entry) => entry.source).join(", ")}` : postcodes.map((entry) => `${entry.source} ${entry.value}`).join(" · "),
    });
  }

  // Income: payslip gross vs bank net. UK take-home is roughly 60–85% of gross.
  if (income?.annualGrossIncome != null && bank?.monthlyNetSalary != null) {
    const ratio = (bank.monthlyNetSalary * 12) / income.annualGrossIncome;
    const ok = ratio >= 0.5 && ratio <= 0.95;
    checks.push({
      key: "income",
      label: "Income",
      status: ok ? "ok" : "mismatch",
      detail: `${money(income.annualGrossIncome)} gross on the payslip; bank shows ${money(bank.monthlyNetSalary)}/mo net (${Math.round(ratio * 100)}% of gross)${ok ? "" : " — does not look like the same job"}`,
    });
  }
  // Employer named on the payslip vs the salary payer.
  if (income?.employerName && bank?.employerName) {
    const same = sameName(income.employerName, bank.employerName, true);
    checks.push({
      key: "employer",
      label: "Employer",
      status: same ? "ok" : "attention",
      detail: same ? `${income.employerName} pays the salary` : `Payslip from ${income.employerName}, salary paid by ${bank.employerName}`,
    });
  }

  // Commitments: credit report vs what the bank statement shows leaving the account.
  if (credit?.monthlyCommitments != null && bank?.monthlyCommitments != null) {
    const larger = Math.max(credit.monthlyCommitments, bank.monthlyCommitments);
    const close = larger === 0 || Math.abs(credit.monthlyCommitments - bank.monthlyCommitments) / larger <= 0.25;
    checks.push({
      key: "commitments",
      label: "Monthly commitments",
      status: close ? "ok" : "attention",
      detail: `credit report ${money(credit.monthlyCommitments)}/mo, bank statement ${money(bank.monthlyCommitments)}/mo`,
    });
  }

  // Single-document flags an underwriter will ask about.
  if (id?.expiryDate) {
    const days = Math.round((Date.parse(id.expiryDate) - Date.now()) / 86_400_000);
    if (days < 0) checks.push({ key: "id_expiry", label: "ID expiry", status: "mismatch", detail: `ID expired on ${id.expiryDate}` });
    else if (days <= 90) checks.push({ key: "id_expiry", label: "ID expiry", status: "attention", detail: `ID expires on ${id.expiryDate} (${days} days)` });
    else checks.push({ key: "id_expiry", label: "ID expiry", status: "ok", detail: `Valid until ${id.expiryDate}` });
  }
  if (credit) {
    const adverse: string[] = [];
    if (credit.defaults) adverse.push(`${credit.defaults} default${credit.defaults === 1 ? "" : "s"}`);
    if (credit.ccjs) adverse.push(`${credit.ccjs} CCJ${credit.ccjs === 1 ? "" : "s"}`);
    if (credit.missedPayments) adverse.push(`${credit.missedPayments} missed payment${credit.missedPayments === 1 ? "" : "s"}`);
    if (credit.iva) adverse.push("IVA");
    if (credit.bankruptcy) adverse.push("bankruptcy");
    if (adverse.length > 0) checks.push({ key: "adverse", label: "Adverse credit", status: "attention", detail: adverse.join(", ") });
    else if (credit.defaults === 0 || credit.ccjs === 0) checks.push({ key: "adverse", label: "Adverse credit", status: "ok", detail: "No defaults or CCJs on the report" });
  }
  if (bank) {
    const flags: string[] = [];
    if (bank.gambling) flags.push("gambling transactions");
    if (bank.returnedPayments) flags.push(`${bank.returnedPayments} returned payment${bank.returnedPayments === 1 ? "" : "s"}`);
    if (bank.overdrawn) flags.push("account went overdrawn");
    if (flags.length > 0) checks.push({ key: "conduct", label: "Account conduct", status: "attention", detail: flags.join(", ") });
  }
  return checks;
}

/** Same person/company, allowing for titles, middle names, "Ltd" and ordering. */
function sameName(a: string, b: string, company = false) {
  const tokens = (value: string) => new Set(
    value.toLowerCase()
      .replace(company ? /\b(ltd|limited|plc|llp|the|&|and|co)\b/g : /\b(mr|mrs|ms|miss|mx|dr|prof)\b/g, "")
      .replace(/[^a-z ]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 1),
  );
  const left = tokens(a), right = tokens(b);
  if (left.size === 0 || right.size === 0) return false;
  const shared = [...left].filter((token) => right.has(token)).length;
  return shared >= Math.min(left.size, right.size, 2);
}
