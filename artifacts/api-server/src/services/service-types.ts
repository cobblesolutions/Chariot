/**
 * The service level a case is run at (scope step 5). Mirrored in
 * chariot-platform/src/lib/service-types.ts and as the ServiceType enum in
 * the OpenAPI contract.
 */
export const SERVICE_TYPES = [
  { value: "full_advice", label: "Advised", needsAdvice: true },
  { value: "light_advice", label: "Light advised", needsAdvice: true },
  { value: "execution_only", label: "Execution only", needsAdvice: false },
] as const;

export type ServiceType = (typeof SERVICE_TYPES)[number]["value"];

export const SERVICE_TYPE_VALUES = SERVICE_TYPES.map((item) => item.value) as ServiceType[];

export function isServiceType(value: string): value is ServiceType {
  return (SERVICE_TYPE_VALUES as string[]).includes(value);
}

export function serviceTypeLabel(value: string): string {
  return SERVICE_TYPES.find((item) => item.value === value)?.label ?? value.replace(/_/g, " ");
}

/** Advised levels send the written advice to the client; execution-only and broking do not. */
export function needsAdvice(value: string): boolean {
  return SERVICE_TYPES.find((item) => item.value === value)?.needsAdvice ?? false;
}
