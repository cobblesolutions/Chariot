import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  integer,
  foreignKey,
  index,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  unique,
} from "drizzle-orm/pg-core";

const money = (name: string) =>
  numeric(name, { precision: 14, scale: 2, mode: "number" });

export const appUsersTable = pgTable(
  "app_users",
  {
    id: serial("id").primaryKey(),
    displayName: text("display_name").notNull(),
    email: text("email").notNull(),
    role: text("role").notNull(),
    passwordHash: text("password_hash"),
    /** Staff-only PIN login credential (hashed). Null for client accounts. */
    pinHash: text("pin_hash"),
    pinFailedAttempts: integer("pin_failed_attempts").notNull().default(0),
    pinLockedUntil: timestamp("pin_locked_until", { withTimezone: true }),
    /**
     * Another staff member whose case pipeline this user may additionally
     * view, on top of their own. Admin-configured; null means none.
     */
    alsoViewsUserId: integer("also_views_user_id"),
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    active: boolean("active").notNull().default(true),
    lastTaskDigestSentAt: timestamp("last_task_digest_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("app_users_email_idx").on(table.email),
    foreignKey({
      columns: [table.alsoViewsUserId],
      foreignColumns: [table.id],
      name: "app_users_also_views_user_id_fk",
    }).onDelete("set null"),
  ],
);

export const sessionsTable = pgTable(
  "user_sessions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => appUsersTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("user_sessions_token_hash_idx").on(table.tokenHash)],
);

export const clientsTable = pgTable(
  "clients",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    companyName: text("company_name").notNull().default(""),
    phone: text("phone").notNull(),
    email: text("email").notNull(),
    onboardingStatus: text("onboarding_status")
      .notNull()
      .default("not_started"),
    // Personal
    title: text("title"),
    dateOfBirth: date("date_of_birth", { mode: "string" }),
    nationality: text("nationality"),
    maritalStatus: text("marital_status"),
    dependants: integer("dependants"),
    // Addresses are street line + city + postcode (see formatAddress()).
    currentAddress: text("current_address"),
    currentAddressCity: text("current_address_city"),
    currentAddressPostcode: text("current_address_postcode"),
    previousAddress: text("previous_address"),
    previousAddressCity: text("previous_address_city"),
    previousAddressPostcode: text("previous_address_postcode"),
    alternativePhone: text("alternative_phone"),
    // Employment & income
    employmentStatus: text("employment_status"),
    employerName: text("employer_name"),
    jobTitle: text("job_title"),
    annualIncome: money("annual_income"),
    otherIncome: money("other_income"),
    monthlyCommitments: money("monthly_commitments"),
    creditHistoryNotes: text("credit_history_notes"),
    // Company
    companyNumber: text("company_number"),
    companyRegisteredAddress: text("company_registered_address"),
    companyRegisteredCity: text("company_registered_city"),
    companyRegisteredPostcode: text("company_registered_postcode"),
    notes: text("notes"),
    // Enquiry stage. A client starts life as an enquiry (basic details only);
    // accepting it sends the welcome/portal email and opens advanced info.
    /** enquiry | onboarding | active | declined | lost */
    lifecycle: text("lifecycle").notNull().default("enquiry"),
    /** email | phone | website | referral | introducer | existing_client | other */
    source: text("source"),
    introducerName: text("introducer_name"),
    introducerContact: text("introducer_contact"),
    /** Staff owner of the enquiry until it is accepted. */
    assignedUserId: integer("assigned_user_id").references(() => appUsersTable.id, { onDelete: "set null" }),
    /** purchase | remortgage | refinance | bridging | development | commercial | other */
    enquiryType: text("enquiry_type"),
    enquirySummary: text("enquiry_summary"),
    enquiryTimescale: text("enquiry_timescale"),
    enquiryEmailText: text("enquiry_email_text"),
    enquiryEmailSubject: text("enquiry_email_subject"),
    enquiryEmailFrom: text("enquiry_email_from"),
    /** Raw AI/heuristic extraction output, kept for audit. */
    enquiryExtracted: jsonb("enquiry_extracted"),
    enquiryExtractionModel: text("enquiry_extraction_model"),
    enquiryReceivedAt: timestamp("enquiry_received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedByUserId: integer("accepted_by_user_id").references(() => appUsersTable.id, { onDelete: "set null" }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    outcomeReason: text("outcome_reason"),
    // Terms of Business (part of onboarding): accepted in the portal, or a signed copy received.
    tobAcceptedAt: timestamp("tob_accepted_at", { withTimezone: true }),
    /** portal | signed_upload | staff */
    tobAcceptedVia: text("tob_accepted_via"),
    tobVersion: integer("tob_version"),
    tobAcceptedByUserId: integer("tob_accepted_by_user_id").references(() => appUsersTable.id, { onDelete: "set null" }),
    tobNote: text("tob_note"),
    /** Set once, the first time every onboarding item is complete; the notifications fire then. */
    onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
    /**
     * Client fields whose current value was written by the document reading
     * system (not typed by staff). The UI shows them highlighted; a field
     * leaves the list as soon as staff save a different value for it.
     */
    documentFilledFields: jsonb("document_filled_fields").notNull().default([]),
    // CRM: kept in sync by the interaction log (see clientInteractionsTable).
    lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
    nextFollowUpAt: date("next_follow_up_at", { mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("clients_email_idx").on(table.email),
    index("clients_lifecycle_idx").on(table.lifecycle),
    index("clients_follow_up_idx").on(table.nextFollowUpAt),
  ],
);

export const CLIENT_LIFECYCLES = ["enquiry", "onboarding", "active", "declined", "lost"] as const;
export type ClientLifecycle = (typeof CLIENT_LIFECYCLES)[number];
export const CLIENT_SOURCES = ["email", "phone", "website", "referral", "introducer", "existing_client", "other"] as const;
export type ClientSource = (typeof CLIENT_SOURCES)[number];
export const ENQUIRY_TYPES = ["purchase", "remortgage", "refinance", "bridging", "development", "commercial", "other"] as const;
export type EnquiryType = (typeof ENQUIRY_TYPES)[number];

/** A logged touchpoint with a client: a call, email, meeting or plain note. */
export const clientInteractionsTable = pgTable(
  "client_interactions",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id").references(() => casesTable.id, { onDelete: "set null" }),
    /** call | email | meeting | note */
    kind: text("kind").notNull().default("note"),
    summary: text("summary").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: integer("created_by_user_id").references(() => appUsersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("client_interactions_client_idx").on(table.clientId, table.occurredAt)],
);

export const INTERACTION_KINDS = ["call", "email", "meeting", "note"] as const;
export type InteractionKind = (typeof INTERACTION_KINDS)[number];

export const clientOnboardingItemsTable = pgTable(
  "client_onboarding_items",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id").references(() => clientsTable.id, {
      onDelete: "set null",
    }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    kind: text("kind").notNull(),
    value: text("value"),
    status: text("status").notNull().default("required"),
    sortOrder: integer("sort_order").notNull().default(0),
    updatedByUserId: integer("updated_by_user_id").references(() => appUsersTable.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("client_onboarding_client_key_idx").on(table.clientId, table.key),
    index("client_onboarding_client_idx").on(table.clientId),
  ],
);

/**
 * A client is linked to exactly one portal user.  Keeping the relationship on
 * app_users allows the authentication layer to resolve ownership without
 * relying on a mutable display name or email address.
 */
export const clientPortalUsersTable = pgTable(
  "client_portal_users",
  {
    clientId: integer("client_id")
      .notNull()
      .primaryKey()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => appUsersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("client_portal_users_user_idx").on(table.userId)],
);

/**
 * Tokens are stored only as SHA-256 hashes.  The plaintext token is used in
 * the setup/reset email and is never returned by an API.
 */
export const portalInvitationsTable = pgTable(
  "portal_invitations",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => appUsersTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    purpose: text("purpose").notNull().default("activation"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    deliveryStatus: text("delivery_status").notNull().default("pending"),
    deliveryError: text("delivery_error"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("portal_invitations_token_hash_idx").on(table.tokenHash),
    index("portal_invitations_user_expiry_idx").on(table.userId, table.expiresAt),
  ],
);

export const passwordResetTokensTable = pgTable(
  "password_reset_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => appUsersTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("password_reset_tokens_token_hash_idx").on(table.tokenHash),
    index("password_reset_tokens_user_idx").on(table.userId),
  ],
);

export const propertiesTable = pgTable(
  "properties",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id").references(() => clientsTable.id, { onDelete: "set null" }),
    address: text("address").notNull(),
    city: text("city"),
    postcode: text("postcode"),
    matterType: text("matter_type").notNull(),
    value: money("value").notNull(),
    loanAmount: money("loan_amount").notNull(),
    rent: money("rent"),
    gdv: money("gdv"),
    // Property details
    propertyType: text("property_type"),
    tenure: text("tenure"),
    leaseYearsRemaining: integer("lease_years_remaining"),
    bedrooms: integer("bedrooms"),
    yearBuilt: integer("year_built"),
    epcRating: text("epc_rating"),
    // Occupancy & letting
    occupancy: text("occupancy"),
    tenancyType: text("tenancy_type"),
    // Purchase & existing mortgage
    purchasePrice: money("purchase_price"),
    purchaseDate: date("purchase_date", { mode: "string" }),
    currentLender: text("current_lender"),
    currentRatePct: numeric("current_rate_pct", { precision: 6, scale: 3, mode: "number" }),
    currentBalance: money("current_balance"),
    currentRateEndDate: date("current_rate_end_date", { mode: "string" }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("properties_client_idx").on(table.clientId)],
);

export const PROPERTY_VALUATION_SOURCES = ["case_valuation", "manual", "estimate"] as const;
export type PropertyValuationSource = (typeof PROPERTY_VALUATION_SOURCES)[number];

/** Append-only valuation history for a property; properties.value mirrors the latest row. */
export const propertyValuationsTable = pgTable(
  "property_valuations",
  {
    id: serial("id").primaryKey(),
    propertyId: integer("property_id")
      .notNull()
      .references(() => propertiesTable.id, { onDelete: "cascade" }),
    amount: money("amount").notNull(),
    valuedAt: date("valued_at", { mode: "string" }).notNull(),
    /** case_valuation | manual | estimate */
    source: text("source").notNull().default("manual"),
    caseId: integer("case_id").references(() => casesTable.id, { onDelete: "set null" }),
    notes: text("notes").notNull().default(""),
    recordedByUserId: integer("recorded_by_user_id").references(() => appUsersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("property_valuations_property_idx").on(table.propertyId, table.valuedAt)],
);

export const lendersTable = pgTable("lenders", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  portfolioStage: text("portfolio_stage").notNull().default("submission"),
  avgDecisionDays: numeric("avg_decision_days", {
    precision: 6,
    scale: 1,
    mode: "number",
  })
    .notNull()
    .default(0),
  status: text("status").notNull().default("active"),
  profile: jsonb("profile").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const lenderContactsTable = pgTable(
  "lender_contacts",
  {
    id: serial("id").primaryKey(),
    lenderId: integer("lender_id")
      .notNull()
      .references(() => lendersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    role: text("role").notNull().default("contact"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("lender_contacts_lender_idx").on(table.lenderId)],
);

export const casesTable = pgTable(
  "cases",
  {
    id: serial("id").primaryKey(),
    reference: text("reference").notNull(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clientsTable.id),
    propertyId: integer("property_id").references(() => propertiesTable.id),
    propertyAddress: text("property_address").notNull(),
    matterType: text("matter_type").notNull(),
    /** full_advice | light_advice | execution_only */
    serviceType: text("service_type").notNull(),
    /** Scope step 5: the adviser (an administrator) confirms the service level before advice goes out. */
    serviceLevelConfirmedAt: timestamp("service_level_confirmed_at", { withTimezone: true }),
    serviceLevelConfirmedByUserId: integer("service_level_confirmed_by_user_id").references(() => appUsersTable.id, { onDelete: "set null" }),
    stageIndex: integer("stage_index").notNull().default(0),
    stageStartedAt: timestamp("stage_started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    status: text("status").notNull().default("active"),
    onboardingReminderSentAt: timestamp("onboarding_reminder_sent_at", { withTimezone: true }),
    loanAmount: money("loan_amount").notNull(),
    propertyValue: money("property_value").notNull(),
    rent: money("rent"),
    gdv: money("gdv"),
    /** Display snapshot of the case handler; `assignedUserId` is the link that survives renames. */
    assignedTo: text("assigned_to").notNull(),
    assignedUserId: integer("assigned_user_id").references(() => appUsersTable.id, { onDelete: "set null" }),
    lenderId: integer("lender_id").references(() => lendersTable.id),
    lenderCaseNumber: text("lender_case_number"),
    /** Reference shown across the app once a lender case number is set; falls back to `reference` when null. */
    displayReference: text("display_reference"),
    valuationDate: timestamp("valuation_date", { withTimezone: true }),
    /** Set when staff confirm the valuation took place (from the case, its calendar event or its task). */
    valuationCompletedAt: timestamp("valuation_completed_at", { withTimezone: true }),
    /** The figure the lender's valuer returned; becomes the case/property value once confirmed. */
    valuationAmount: money("valuation_amount"),
    /** Day the mortgage is expected to complete; drives the completion calendar event and follow-up task. */
    expectedCompletionDate: timestamp("expected_completion_date", { withTimezone: true }),
    applicationFeeConfirmed: boolean("application_fee_confirmed").notNull().default(false),
    applicationFeeConfirmedAt: timestamp("application_fee_confirmed_at", { withTimezone: true }),
    bankDecisionRequested: boolean("bank_decision_requested").notNull().default(false),
    bankDecisionRequestedAt: timestamp("bank_decision_requested_at", { withTimezone: true }),
    /** Set once the current underwriting round's requirements are all satisfied and staff confirm the case is ready to move on. */
    underwritingCleared: boolean("underwriting_cleared").notNull().default(false),
    underwritingClearedAt: timestamp("underwriting_cleared_at", { withTimezone: true }),
    draftNotes: text("draft_notes").notNull().default(""),
    /** Legacy: stage indexes that were auto-skipped before Advice became the first stage; shown as N/A. */
    skippedStageIndexes: jsonb("skipped_stage_indexes").notNull().default([]),
    procFeePct: numeric("proc_fee_pct", { precision: 6, scale: 3, mode: "number" })
      .notNull()
      .default(1),
    brokerFeePct: numeric("broker_fee_pct", { precision: 6, scale: 3, mode: "number" })
      .notNull()
      .default(0.5),
    /** The fee the client agreed under the Terms of Business: percent | flat. The invoice reads this. */
    brokerFeeBasis: text("broker_fee_basis").notNull().default("percent"),
    brokerFeeFlat: money("broker_fee_flat"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("cases_reference_idx").on(table.reference),
    index("cases_client_updated_idx").on(table.clientId, table.updatedAt),
    index("cases_lender_idx").on(table.lenderId),
    index("cases_assigned_user_idx").on(table.assignedUserId),
  ],
);

/**
 * Scope step 6: the adviser's written recommendation for a case. One editable
 * draft per case; every send to the client snapshots it into client_approvals.
 */
export const caseAdviceTable = pgTable(
  "case_advice",
  {
    id: serial("id").primaryKey(),
    caseId: integer("case_id").notNull().references(() => casesTable.id, { onDelete: "cascade" }),
    lenderId: integer("lender_id").references(() => lendersTable.id, { onDelete: "set null" }),
    product: text("product"),
    ratePct: numeric("rate_pct", { precision: 6, scale: 3, mode: "number" }),
    termYears: integer("term_years"),
    monthlyPayment: money("monthly_payment"),
    arrangementFee: money("arrangement_fee"),
    /** The recommendation in the adviser's words — this is what the client reads. */
    summary: text("summary"),
    /** Why this lender/product; kept on file, not necessarily sent. */
    reasoning: text("reasoning"),
    /** adviser (written advice) | client_email (extracted from the client's instruction) | staff (typed in) */
    source: text("source"),
    /** For execution-only: the client's email the instruction was read from, kept for audit. */
    instructionEmailText: text("instruction_email_text"),
    updatedByUserId: integer("updated_by_user_id").references(() => appUsersTable.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("case_advice_case_idx").on(table.caseId)],
);

/**
 * Something the client was asked to approve: the advice (step 6) or the
 * submission details (step 7). Each send is a versioned snapshot with a
 * one-click email token; the answer can arrive by email link, from the
 * portal, or be recorded by staff after a call.
 */
export const clientApprovalsTable = pgTable(
  "client_approvals",
  {
    id: serial("id").primaryKey(),
    caseId: integer("case_id").notNull().references(() => casesTable.id, { onDelete: "cascade" }),
    /** advice | submission_details */
    kind: text("kind").notNull(),
    version: integer("version").notNull().default(1),
    /** Exactly what the client was shown, so a later edit never changes what was approved. */
    snapshot: jsonb("snapshot").notNull().default({}),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    sentByUserId: integer("sent_by_user_id").references(() => appUsersTable.id, { onDelete: "set null" }),
    /** pending | sent | disabled | failed */
    deliveryStatus: text("delivery_status").notNull().default("pending"),
    deliveryError: text("delivery_error"),
    /** approved | discuss */
    response: text("response"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    /** email | portal | staff */
    respondedVia: text("responded_via"),
    note: text("note"),
    recordedByUserId: integer("recorded_by_user_id").references(() => appUsersTable.id, { onDelete: "set null" }),
  },
  (table) => [
    uniqueIndex("client_approvals_token_idx").on(table.tokenHash),
    index("client_approvals_case_idx").on(table.caseId, table.kind, table.version),
  ],
);

/**
 * UNUSED — superseded by `terms_of_business_templates` (2026-09-17). Kept in
 * the schema only so a push does not need to drop it; remove it in a later
 * `push-force`.
 */
export const termsOfBusinessVersionsTable = pgTable(
  "terms_of_business_versions",
  {
    id: serial("id").primaryKey(),
    version: integer("version").notNull(),
    objectPath: text("object_path").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    publishedByUserId: integer("published_by_user_id").references(() => appUsersTable.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("terms_of_business_versions_version_idx").on(table.version)],
);

/**
 * Firm-wide settings that are not per user or per case: one row per key with a
 * JSON value. Currently holds `docusign_connection` (the signed-in DocuSign
 * account's tokens — see integrations/docusign.ts).
 */
export const firmSettingsTable = pgTable("firm_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull(),
  value: jsonb("value").notNull().default({}),
  updatedByUserId: integer("updated_by_user_id").references(() => appUsersTable.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [uniqueIndex("firm_settings_key_idx").on(table.key)]);

export const TERMS_FIELD_TYPES = ["text", "textarea", "number", "currency", "date", "select"] as const;
export type TermsFieldType = (typeof TERMS_FIELD_TYPES)[number];

/** A dynamic field the template asks staff to fill for each client; `{{key}}` in the body is replaced by the value. */
export interface TermsTemplateField {
  key: string;
  label: string;
  type: TermsFieldType;
  required: boolean;
  /** Choices for `select`. */
  options?: string[];
  defaultValue?: string;
  hint?: string;
}

/**
 * The firm's Terms of Business as an editable template: a body with
 * {{tokens}} and the dynamic fields staff fill per client. Every published
 * version is kept — an agreement records the version it was generated from.
 * The current version is the highest number.
 */
export const termsOfBusinessTemplatesTable = pgTable(
  "terms_of_business_templates",
  {
    id: serial("id").primaryKey(),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    fields: jsonb("fields").$type<TermsTemplateField[]>().notNull().default([]),
    publishedByUserId: integer("published_by_user_id").references(() => appUsersTable.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("terms_of_business_templates_version_idx").on(table.version)],
);

export const TERMS_AGREEMENT_STATUSES = ["draft", "sent", "signed", "declined", "voided"] as const;
export type TermsAgreementStatus = (typeof TERMS_AGREEMENT_STATUSES)[number];

export const TERMS_SIGNED_VIAS = ["docusign", "signed_upload", "staff"] as const;
export type TermsSignedVia = (typeof TERMS_SIGNED_VIAS)[number];

/**
 * The Terms of Business for one case: the field values staff filled in, the
 * generated PDF, and where it is in the signature flow. One row per attempt;
 * the newest is the case's current agreement and earlier declined / voided
 * ones stay as history. Once signed, the signed copy is filed in the case's
 * documents (`signed_document_id`). Every case signs its own terms — nothing
 * is recorded on the client.
 */
export const caseTermsAgreementsTable = pgTable(
  "case_terms_agreements",
  {
    id: serial("id").primaryKey(),
    caseId: integer("case_id").notNull().references(() => casesTable.id, { onDelete: "cascade" }),
    /** Denormalised from the case so the signed document can be filed without a join. */
    clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
    templateVersion: integer("template_version").notNull(),
    values: jsonb("values").$type<Record<string, string>>().notNull().default({}),
    status: text("status").$type<TermsAgreementStatus>().notNull().default("draft"),
    /** The generated (unsigned) PDF. */
    objectPath: text("object_path"),
    filename: text("filename"),
    byteSize: integer("byte_size"),
    signedDocumentId: integer("signed_document_id").references(() => documentsTable.id, { onDelete: "set null" }),
    /** docusign | docusign_mock */
    provider: text("provider"),
    envelopeId: text("envelope_id"),
    envelopeStatus: text("envelope_status"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    recipientName: text("recipient_name"),
    recipientEmail: text("recipient_email"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    sentByUserId: integer("sent_by_user_id").references(() => appUsersTable.id, { onDelete: "set null" }),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    /** How the signature arrived: DocuSign, a signed copy uploaded by staff, or recorded by staff. */
    signedVia: text("signed_via").$type<TermsSignedVia>(),
    signedNote: text("signed_note"),
    signedByUserId: integer("signed_by_user_id").references(() => appUsersTable.id, { onDelete: "set null" }),
    declinedAt: timestamp("declined_at", { withTimezone: true }),
    declineReason: text("decline_reason"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    voidedByUserId: integer("voided_by_user_id").references(() => appUsersTable.id, { onDelete: "set null" }),
    createdByUserId: integer("created_by_user_id").references(() => appUsersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    index("case_terms_agreements_case_idx").on(table.caseId, table.createdAt),
    index("case_terms_agreements_client_idx").on(table.clientId, table.createdAt),
    index("case_terms_agreements_envelope_idx").on(table.envelopeId),
  ],
);

/**
 * One row per enquiry a client has made. The `enquiry_*` columns on clients
 * hold the latest one (what the Add page and CRM read); this is the history,
 * so a repeat enquiry no longer erases the previous email.
 */
export const clientEnquiriesTable = pgTable(
  "client_enquiries",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    source: text("source"),
    enquiryType: text("enquiry_type"),
    summary: text("summary"),
    timescale: text("timescale"),
    emailFrom: text("email_from"),
    emailSubject: text("email_subject"),
    emailText: text("email_text"),
    extracted: jsonb("extracted"),
    extractionModel: text("extraction_model"),
    /** open | accepted | declined | lost */
    status: text("status").notNull().default("open"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    outcomeReason: text("outcome_reason"),
    createdByUserId: integer("created_by_user_id").references(() => appUsersTable.id, { onDelete: "set null" }),
  },
  (table) => [index("client_enquiries_client_idx").on(table.clientId, table.receivedAt)],
);

/**
 * Editable copy for outbound emails. Only the words are stored — the branded
 * HTML shell (logo, colours, button, footer) is fixed in code. One row per
 * template key; missing rows fall back to the built-in default text.
 */
export const emailTemplatesTable = pgTable("email_templates", {
  id: serial("id").primaryKey(),
  /** client_welcome | … */
  key: text("key").notNull(),
  subject: text("subject").notNull(),
  heading: text("heading").notNull(),
  /** Plain text; blank lines separate paragraphs. Placeholders like {{firstName}} are substituted at send time. */
  body: text("body").notNull(),
  updatedByUserId: integer("updated_by_user_id").references(() => appUsersTable.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [uniqueIndex("email_templates_key_idx").on(table.key)]);

export const caseStageThresholdsTable = pgTable(
  "case_stage_thresholds",
  {
    id: serial("id").primaryKey(),
    stageIndex: integer("stage_index").notNull(),
    thresholdDays: integer("threshold_days"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("case_stage_thresholds_stage_idx").on(table.stageIndex)],
);

/**
 * Master default assignee for each section of the Add flow
 * ("client" | "property" | "case"). Configured in Settings; when a section
 * has no row (or its user is inactive) the API falls back to a role default.
 */
export const sectionDefaultAssigneesTable = pgTable(
  "section_default_assignees",
  {
    id: serial("id").primaryKey(),
    section: text("section").notNull(),
    userId: integer("user_id").references(() => appUsersTable.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("section_default_assignees_section_idx").on(table.section)],
);

export const caseStressTestsTable = pgTable(
  "case_stress_tests",
  {
    id: serial("id").primaryKey(),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),
    /** One stress test per lender submission (null = case-level, pre-submissions). */
    submissionId: integer("submission_id").references(() => caseSubmissionsTable.id, { onDelete: "set null" }),
    lenderId: integer("lender_id").references(() => lendersTable.id),
    monthlyRent: money("monthly_rent"),
    propertyValue: money("property_value"),
    stressRate: numeric("stress_rate", { precision: 6, scale: 3, mode: "number" }),
    payRate: numeric("pay_rate", { precision: 6, scale: 3, mode: "number" }),
    stressAtPayRate: boolean("stress_at_pay_rate").notNull().default(true),
    stressMargin: numeric("stress_margin", { precision: 6, scale: 3, mode: "number" })
      .notNull()
      .default(2),
    icrMultiplier: numeric("icr_multiplier", { precision: 6, scale: 3, mode: "number" })
      .notNull()
      .default(1.25),
    targetLtv: numeric("target_ltv", { precision: 6, scale: 3, mode: "number" })
      .notNull()
      .default(75),
    arrFeeMode: text("arr_fee_mode").notNull().default("pct"),
    arrFeePct: numeric("arr_fee_pct", { precision: 6, scale: 3, mode: "number" }),
    arrFeeFixed: money("arr_fee_fixed"),
    stressBasis: text("stress_basis").notNull().default("total"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [unique("case_stress_tests_case_sub").on(table.caseId, table.submissionId).nullsNotDistinct()],
);

export const requirementsTable = pgTable(
  "case_requirements",
  {
    id: serial("id").primaryKey(),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),
    /** Set for stages from Submission on, where each lender submission has its own requirements. */
    submissionId: integer("submission_id").references(() => caseSubmissionsTable.id, { onDelete: "set null" }),
    stageIndex: integer("stage_index").notNull(),
    label: text("label").notNull(),
    complete: boolean("complete").notNull().default(false),
    required: boolean("required").notNull().default(true),
    /** Requirement round within the stage; a new round starts once the prior round is fully complete. */
    round: integer("round").notNull().default(1),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: text("completed_by"),
  },
  (table) => [
    unique("case_requirements_case_sub_label_round").on(table.caseId, table.submissionId, table.label, table.round).nullsNotDistinct(),
  ],
);

/**
 * A raw bank-requirements email pasted into a case, logged for reference
 * alongside the round of requirements it produced. Multiple rows can share
 * the same round if a paste lands in an already-open round.
 */
export const underwritingRoundsTable = pgTable(
  "underwriting_rounds",
  {
    id: serial("id").primaryKey(),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),
    round: integer("round").notNull(),
    emailText: text("email_text").notNull(),
    createdByUserId: integer("created_by_user_id").references(() => appUsersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** The lender submission this round is with; null for cases from before submissions existed. */
    submissionId: integer("submission_id").references(() => caseSubmissionsTable.id, { onDelete: "set null" }),
    /** The case handler's task whose checkboxes are this round's requirements. */
    taskId: integer("task_id").references(() => tasksTable.id, { onDelete: "set null" }),
    /** Everything provided and sent back to the lender; the next round may start. */
    sentAt: timestamp("sent_at", { withTimezone: true }),
    sentByUserId: integer("sent_by_user_id").references(() => appUsersTable.id, { onDelete: "set null" }),
  },
  (table) => [index("underwriting_rounds_case_idx").on(table.caseId, table.round)],
);

export const tasksTable = pgTable("tasks", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id")
    .references(() => casesTable.id, { onDelete: "cascade" }),
  /** Client the task is about, for tasks not tied to a case (onboarding, property review). */
  clientId: integer("client_id").references(() => clientsTable.id, { onDelete: "set null" }),
  /** Property the task is about (property review tasks). */
  propertyId: integer("property_id").references(() => propertiesTable.id, { onDelete: "set null" }),
  /** Why the task exists: enquiry_review | client_onboarding | advanced_info | property_review | case_submission | stage_handoff | … ; null for manual tasks. */
  kind: text("kind"),
  /** Pipeline stage a stage hand-off task covers; its checklist mirrors that stage's steps. */
  stageIndex: integer("stage_index"),
  title: text("title").notNull(),
  assignee: text("assignee").notNull(),
  assignedUserId: integer("assigned_user_id").references(() => appUsersTable.id),
  status: text("status").notNull().default("todo"),
  priority: text("priority").notNull().default("normal"),
  dueDate: date("due_date", { mode: "string" }).notNull(),
  notes: text("notes").notNull().default(""),
  /** Staff user who created the task; null for system-generated handoff tasks. */
  createdByUserId: integer("created_by_user_id").references(() => appUsersTable.id),
  /** Calendar event this task follows up (valuation / completion dates); completing one side completes the other. */
  calendarEventId: integer("calendar_event_id").references(() => calendarEventsTable.id, { onDelete: "set null" }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completedByUserId: integer("completed_by_user_id").references(
    () => appUsersTable.id,
  ),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  index("tasks_assigned_due_idx").on(table.assignedUserId, table.dueDate),
  index("tasks_case_idx").on(table.caseId),
]);

/** Sub-steps inside a task, ticked off individually from the task inspector. */
export const taskChecklistItemsTable = pgTable("task_checklist_items", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id")
    .notNull()
    .references(() => tasksTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  done: boolean("done").notNull().default(false),
  position: integer("position").notNull().default(0),
  /** Record field this step mirrors (e.g. "phone", "onboarding:identity"); such steps tick themselves. */
  sourceKey: text("source_key"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [index("task_checklist_items_task_idx").on(table.taskId, table.position)]);

/** Staff discussion on a task, shown as a thread in the task inspector. */
export const taskCommentsTable = pgTable("task_comments", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id")
    .notNull()
    .references(() => tasksTable.id, { onDelete: "cascade" }),
  authorUserId: integer("author_user_id").references(() => appUsersTable.id),
  authorName: text("author_name").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [index("task_comments_task_idx").on(table.taskId, table.createdAt)]);

/**
 * One lender submission on a case. A case may be submitted to several lenders
 * at once; each carries its own DIP, case number, fee, valuation and decision
 * tracking, and can be withdrawn or declined on its own. The case's own
 * lender columns mirror the *primary* submission so the pipeline, stress test
 * and offer review keep working on a single lender.
 */
export const caseSubmissionsTable = pgTable(
  "case_submissions",
  {
    id: serial("id").primaryKey(),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),
    lenderId: integer("lender_id")
      .notNull()
      .references(() => lendersTable.id),
    /** active | withdrawn | declined | offered */
    status: text("status").notNull().default("active"),
    /** The submission the case follows; exactly one active submission per case (enforced in code). */
    isPrimary: boolean("is_primary").notNull().default(false),
    lenderCaseNumber: text("lender_case_number"),
    applicationFeeConfirmed: boolean("application_fee_confirmed").notNull().default(false),
    applicationFeeConfirmedAt: timestamp("application_fee_confirmed_at", { withTimezone: true }),
    valuationDate: timestamp("valuation_date", { withTimezone: true }),
    valuationCompletedAt: timestamp("valuation_completed_at", { withTimezone: true }),
    bankDecisionRequested: boolean("bank_decision_requested").notNull().default(false),
    bankDecisionRequestedAt: timestamp("bank_decision_requested_at", { withTimezone: true }),
    notes: text("notes").notNull().default(""),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closeReason: text("close_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("case_submissions_case_lender_idx").on(table.caseId, table.lenderId),
    index("case_submissions_case_idx").on(table.caseId),
  ],
);

export const documentsTable = pgTable("documents", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id")
    .notNull()
    .references(() => clientsTable.id, { onDelete: "cascade" }),
  caseId: integer("case_id").references(() => casesTable.id, {
    onDelete: "cascade",
  }),
  /** Lender submission this document belongs to (e.g. a per-lender DIP). */
  submissionId: integer("submission_id").references(() => caseSubmissionsTable.id, {
    onDelete: "set null",
  }),
  name: text("name").notNull(),
  category: text("category").notNull(),
  /** Opaque driver key; never return this value to browser clients. */
  objectPath: text("object_path"),
  contentType: text("content_type"),
  byteSize: integer("byte_size"),
  uploadedByUserId: integer("uploaded_by_user_id").references(
    () => appUsersTable.id,
  ),
  status: text("status").notNull().default("required"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
  /** Set by staff on documents that go stale (ID, payslips, statements); the tile is flagged once it passes. */
  expiresAt: date("expires_at", { mode: "string" }),
}, (table) => [
  index("documents_client_idx").on(table.clientId),
  index("documents_case_idx").on(table.caseId),
]);

export const DOCUMENT_READING_STATUSES = ["pending", "completed", "failed", "unsupported"] as const;
export type DocumentReadingStatus = (typeof DOCUMENT_READING_STATUSES)[number];

/**
 * What the document reading system extracted from an uploaded file. One row
 * per document; `reader` names the extractor that ran (e.g. proof_of_income)
 * and `data` is that reader's structured result. `appliedFields` records
 * which client fields were filled from it so staff can see where a value came from.
 */
export const documentReadingsTable = pgTable("document_readings", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id")
    .notNull()
    .references(() => documentsTable.id, { onDelete: "cascade" }),
  reader: text("reader").notNull(),
  status: text("status").notNull().default("pending"),
  /** "ai" when a model produced the result, "heuristic" for the text-pattern fallback. */
  source: text("source"),
  model: text("model"),
  data: jsonb("data"),
  error: text("error"),
  appliedFields: jsonb("applied_fields").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("document_readings_document_idx").on(table.documentId),
]);

export const lenderOfferReviewsTable = pgTable(
  "lender_offer_reviews",
  {
    id: serial("id").primaryKey(),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),
    /** One review per lender submission (null = case-level, pre-submissions). */
    submissionId: integer("submission_id").references(() => caseSubmissionsTable.id, { onDelete: "set null" }),
    /** The loan the offer is for; the broker fee percentage is taken from this when present. */
    offerLoanAmount: money("offer_loan_amount"),
    documentId: integer("document_id")
      .notNull()
      .references(() => documentsTable.id, { onDelete: "cascade" }),
    offerAddress: text("offer_address").notNull(),
    offerClientName: text("offer_client_name").notNull(),
    offerPropertyValue: money("offer_property_value").notNull(),
    addressMatches: boolean("address_matches").notNull().default(false),
    nameMatches: boolean("name_matches").notNull().default(false),
    valueMatches: boolean("value_matches").notNull().default(false),
    /** Scope step 12: when the offer went to the client (with the invoice) and the lender was told. */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    notifiedByUserId: integer("notified_by_user_id").references(() => appUsersTable.id, { onDelete: "set null" }),
    clientEmailStatus: text("client_email_status"),
    lenderEmailStatus: text("lender_email_status"),
    invoiceId: integer("invoice_id").references(() => invoicesTable.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("lender_offer_reviews_case_sub").on(table.caseId, table.submissionId).nullsNotDistinct(),
    index("lender_offer_reviews_document_idx").on(table.documentId),
  ],
);

export const caseConversationsTable = pgTable(
  "case_conversations",
  {
    id: serial("id").primaryKey(),
    /** Null for a general staff conversation that is not tied to any case. */
    caseId: integer("case_id").references(() => casesTable.id, {
      onDelete: "cascade",
    }),
    kind: text("kind").notNull(),
    /** Optional name set by a participant; null falls back to the derived title. */
    title: text("title"),
    participantKey: text("participant_key").notNull(),
    createdByUserId: integer("created_by_user_id")
      .notNull()
      .references(() => appUsersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("case_conversations_case_participant_key_idx").on(table.caseId, table.participantKey),
    uniqueIndex("case_conversations_global_participant_key_idx")
      .on(table.participantKey)
      .where(sql`${table.caseId} is null`),
  ],
);

export const conversationParticipantsTable = pgTable(
  "conversation_participants",
  {
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => caseConversationsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => appUsersTable.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("conversation_participants_conversation_user_idx").on(table.conversationId, table.userId),
    index("conversation_participants_user_idx").on(table.userId),
  ],
);

export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  /** Null for messages in a general staff conversation not tied to any case. */
  caseId: integer("case_id").references(() => casesTable.id, {
    onDelete: "cascade",
  }),
  sender: text("sender").notNull(),
  senderRole: text("sender_role").notNull(),
  senderUserId: integer("sender_user_id").references(() => appUsersTable.id),
  conversationId: integer("conversation_id").references(() => caseConversationsTable.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  replyToMessageId: integer("reply_to_message_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  index("messages_case_created_idx").on(table.caseId, table.createdAt),
  index("messages_conversation_created_idx").on(table.conversationId, table.createdAt),
  foreignKey({
    columns: [table.replyToMessageId],
    foreignColumns: [table.id],
    name: "messages_reply_to_message_id_fk",
  }).onDelete("set null"),
]);

/** Emoji reactions on chat messages: one row per user and emoji. */
export const messageReactionsTable = pgTable(
  "message_reactions",
  {
    id: serial("id").primaryKey(),
    messageId: integer("message_id")
      .notNull()
      .references(() => messagesTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => appUsersTable.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("message_reactions_message_user_emoji_idx").on(table.messageId, table.userId, table.emoji),
    index("message_reactions_message_idx").on(table.messageId),
  ],
);

/** Files attached to chat messages; stored privately like documents. */
export const messageAttachmentsTable = pgTable(
  "message_attachments",
  {
    id: serial("id").primaryKey(),
    /** Null until the upload is linked to a sent message. */
    messageId: integer("message_id").references(() => messagesTable.id, {
      onDelete: "cascade",
    }),
    uploadedByUserId: integer("uploaded_by_user_id")
      .notNull()
      .references(() => appUsersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    /** Opaque driver key; never return this value to browser clients. */
    objectPath: text("object_path").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("message_attachments_message_idx").on(table.messageId)],
);

/** Staff-only conversation read cursor for each case. */
export const caseMessageReadsTable = pgTable(
  "case_message_reads",
  {
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => appUsersTable.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("last_read_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("case_message_reads_case_user_idx").on(table.caseId, table.userId)],
);

/** Staff read cursor for each direct/group conversation. */
export const conversationReadsTable = pgTable(
  "conversation_reads",
  {
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => caseConversationsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => appUsersTable.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("last_read_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("conversation_reads_conversation_user_idx").on(table.conversationId, table.userId)],
);

/**
 * Per-user inbox settings for a chat thread: a case chat (caseId) or a
 * direct/group conversation (conversationId). Exactly one of the two is set.
 */
export const threadPreferencesTable = pgTable(
  "thread_preferences",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => appUsersTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id").references(() => casesTable.id, { onDelete: "cascade" }),
    conversationId: integer("conversation_id").references(() => caseConversationsTable.id, {
      onDelete: "cascade",
    }),
    pinned: boolean("pinned").notNull().default(false),
    muted: boolean("muted").notNull().default(false),
    archived: boolean("archived").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("thread_preferences_user_case_idx")
      .on(table.userId, table.caseId)
      .where(sql`${table.caseId} is not null`),
    uniqueIndex("thread_preferences_user_conversation_idx")
      .on(table.userId, table.conversationId)
      .where(sql`${table.conversationId} is not null`),
  ],
);

export const calendarEventsTable = pgTable("calendar_events", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").references(() => casesTable.id, {
    onDelete: "cascade",
  }),
  renewalId: integer("renewal_id").references(() => renewalsTable.id, {
    onDelete: "cascade",
  }),
  title: text("title").notNull(),
  eventType: text("event_type").notNull(),
  eventDate: timestamp("event_date", { withTimezone: true }).notNull(),
  /** "manual" | "case_valuation" | "case_completion" | "renewal" — non-manual events mirror a case/renewal date. */
  source: text("source").notNull().default("manual"),
  completed: boolean("completed").notNull().default(false),
  createdByUserId: integer("created_by_user_id").references(
    () => appUsersTable.id,
  ),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  index("calendar_events_date_idx").on(table.eventDate),
  index("calendar_events_renewal_idx").on(table.renewalId),
]);

export const invoiceSequencesTable = pgTable("invoice_sequences", {
  id: integer("id").primaryKey().default(1),
  lastNumber: integer("last_number").notNull().default(0),
});

export const invoicesTable = pgTable(
  "invoices",
  {
    id: serial("id").primaryKey(),
    invoiceNumber: text("invoice_number").notNull(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clientsTable.id),
    caseId: integer("case_id").references(() => casesTable.id),
    status: text("status").notNull().default("draft"),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    notes: text("notes").notNull().default(""),
    createdByUserId: integer("created_by_user_id").references(
      () => appUsersTable.id,
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("invoices_number_idx").on(table.invoiceNumber),
    index("invoices_client_created_idx").on(table.clientId, table.createdAt),
    index("invoices_status_due_idx").on(table.status, table.dueDate),
  ],
);

export const invoiceLineItemsTable = pgTable(
  "invoice_line_items",
  {
    id: serial("id").primaryKey(),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoicesTable.id, { onDelete: "cascade" }),
    description: text("description").notNull().default(""),
    quantity: numeric("quantity", { precision: 12, scale: 2, mode: "number" })
      .notNull()
      .default(1),
    unitAmount: money("unit_amount").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("invoice_line_items_invoice_idx").on(table.invoiceId)],
);

export const invoicePaymentsTable = pgTable(
  "invoice_payments",
  {
    id: serial("id").primaryKey(),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoicesTable.id, { onDelete: "cascade" }),
    amount: money("amount").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    reference: text("reference").notNull().default(""),
    notes: text("notes").notNull().default(""),
    recordedByUserId: integer("recorded_by_user_id")
      .notNull()
      .references(() => appUsersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("invoice_payments_invoice_idx").on(table.invoiceId)],
);

export const renewalsTable = pgTable(
  "renewals",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id").references(() => casesTable.id, {
      onDelete: "set null",
    }),
    type: text("type").notNull(),
    status: text("status").notNull().default("pending"),
    rateEndDate: date("rate_end_date", { mode: "string" }),
    completionDate: date("completion_date", { mode: "string" }),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    nextReminderDate: date("next_reminder_date", { mode: "string" }),
    lastReminderAt: timestamp("last_reminder_at", { withTimezone: true }),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("renewals_status_due_idx").on(table.status, table.dueDate),
    index("renewals_client_idx").on(table.clientId),
  ],
);

export const activitiesTable = pgTable("activities", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").references(() => casesTable.id, {
    onDelete: "cascade",
  }),
  title: text("title").notNull(),
  detail: text("detail").notNull(),
  actorName: text("actor_name").notNull().default("System"),
  /** Machine kind (services/activity-kinds.ts); rows without one are classified from the title when read. */
  kind: text("kind"),
  // Optional pointer at the record the activity is about, so the notifications
  // page can deep-link to it (cases already have caseId above).
  entityType: text("entity_type").$type<ActivityEntityType>(),
  entityId: integer("entity_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const ACTIVITY_ENTITY_TYPES = ["client", "property", "invoice", "renewal", "document"] as const;
export type ActivityEntityType = (typeof ACTIVITY_ENTITY_TYPES)[number];

/**
 * Things that need a person's attention, raised by the rules in
 * services/alerts.ts. `dedupe_key` identifies the condition so it is raised
 * once, acknowledged ("seen"), and resolved when the condition clears.
 */
export const alertsTable = pgTable(
  "alerts",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").notNull(),
    /** red | amber */
    severity: text("severity").notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull().default(""),
    dedupeKey: text("dedupe_key").notNull(),
    caseId: integer("case_id").references(() => casesTable.id, { onDelete: "cascade" }),
    clientId: integer("client_id").references(() => clientsTable.id, { onDelete: "cascade" }),
    taskId: integer("task_id").references(() => tasksTable.id, { onDelete: "cascade" }),
    renewalId: integer("renewal_id").references(() => renewalsTable.id, { onDelete: "cascade" }),
    invoiceId: integer("invoice_id").references(() => invoicesTable.id, { onDelete: "cascade" }),
    assignedUserId: integer("assigned_user_id").references(() => appUsersTable.id, { onDelete: "set null" }),
    raisedAt: timestamp("raised_at", { withTimezone: true }).notNull().defaultNow(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedByUserId: integer("acknowledged_by_user_id").references(() => appUsersTable.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    /** When the assignee was told (red only emails); set for every alert so nothing is sent twice. */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("alerts_dedupe_key_idx").on(table.dedupeKey),
    index("alerts_open_idx").on(table.resolvedAt, table.assignedUserId),
  ],
);

/**
 * Red flags per submission step (scope: "on every step"): days a lender
 * submission may sit at a step before it is flagged and an alert is raised.
 */
export const submissionStepThresholdsTable = pgTable(
  "submission_step_thresholds",
  {
    id: serial("id").primaryKey(),
    /** dip | caseNumber | fee | valuationDate | valuationCompleted | decision */
    stepKey: text("step_key").notNull(),
    thresholdDays: integer("threshold_days"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("submission_step_thresholds_step_idx").on(table.stepKey)],
);
