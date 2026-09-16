/** How our fee is charged on a case — what the invoice and the Terms of Business read. */
export const FEE_BASIS_OPTIONS = [
  { value: "percent", label: "% of loan" },
  { value: "flat", label: "Flat £" },
] as const;

export type FeeBasis = (typeof FEE_BASIS_OPTIONS)[number]["value"];
