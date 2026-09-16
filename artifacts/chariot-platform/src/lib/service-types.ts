import type { ServiceType } from "@workspace/api-client-react";

/** Service levels a case runs at (mirrors api-server/src/services/service-types.ts). */
export const SERVICE_TYPES: ReadonlyArray<{ value: ServiceType; label: string; needsAdvice: boolean; hint: string }> = [
  { value: "full_advice", label: "Advised", needsAdvice: true, hint: "We recommend a lender and product; the client approves the advice." },
  { value: "light_advice", label: "Light advised", needsAdvice: true, hint: "A shorter recommendation; the client still approves it." },
  { value: "execution_only", label: "Execution only", needsAdvice: false, hint: "The client has chosen — record their instruction; they confirm it with the details." },
];

export const serviceTypeLabel = (value: string | null | undefined) =>
  SERVICE_TYPES.find((item) => item.value === value)?.label ?? (value ?? "").replace(/_/g, " ");

export const needsAdvice = (value: string | null | undefined) =>
  SERVICE_TYPES.find((item) => item.value === value)?.needsAdvice ?? false;
