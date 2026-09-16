import type { Client, ClientLifecycle, ClientSource, EnquiryType } from "@workspace/api-client-react";

/** The three steps of the Add page, derived from the client's lifecycle. */
export const ADD_STEPS = [
  { key: "basic", title: "Basic details", hint: "Who they are" },
  { key: "accept", title: "Accept", hint: "Welcome email" },
  { key: "advanced", title: "Advanced", hint: "Client · property · case" },
] as const;
export type AddStepKey = (typeof ADD_STEPS)[number]["key"];

export const LIFECYCLE_LABELS: Record<ClientLifecycle, string> = {
  enquiry: "Awaiting acceptance",
  onboarding: "Advanced info",
  active: "Active",
  declined: "Declined",
  lost: "Lost",
};

export const SOURCE_OPTIONS: ReadonlyArray<{ value: ClientSource; label: string }> = [
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone call" },
  { value: "website", label: "Website" },
  { value: "referral", label: "Referral" },
  { value: "introducer", label: "Introducer" },
  { value: "existing_client", label: "Existing client" },
  { value: "other", label: "Other" },
];

export const ENQUIRY_TYPE_OPTIONS: ReadonlyArray<{ value: EnquiryType; label: string }> = [
  { value: "purchase", label: "Purchase" },
  { value: "remortgage", label: "Remortgage" },
  { value: "refinance", label: "Refinance / capital raise" },
  { value: "bridging", label: "Bridging" },
  { value: "development", label: "Development" },
  { value: "commercial", label: "Commercial" },
  { value: "other", label: "Other" },
];

export const sourceLabel = (value: ClientSource | null | undefined) =>
  SOURCE_OPTIONS.find((option) => option.value === value)?.label ?? null;
export const enquiryTypeLabel = (value: EnquiryType | null | undefined) =>
  ENQUIRY_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? null;

/** Which step of the Add page a client is on. Closed clients show the step they stopped at. */
export function currentAddStep(client: Pick<Client, "lifecycle" | "acceptedAt">): AddStepKey {
  if (client.lifecycle === "enquiry") return "accept";
  if (client.lifecycle === "declined" || client.lifecycle === "lost") {
    return client.acceptedAt ? "advanced" : "accept";
  }
  return "advanced";
}

export const isClosedLifecycle = (lifecycle: ClientLifecycle) =>
  lifecycle === "declined" || lifecycle === "lost";
