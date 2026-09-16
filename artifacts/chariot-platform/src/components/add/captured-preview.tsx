import type { ReactNode } from "react";
import { Briefcase, Home, User } from "lucide-react";
import type { ClientDetail, Property } from "@workspace/api-client-react";
import { cn, formatMoney } from "@/lib/utils";
import { enquiryTypeLabel } from "@/lib/enquiry";

interface Row {
  label: string;
  value: string | null;
}

function money(value: number | null | undefined) {
  return value ? formatMoney(value) : null;
}

/**
 * What step 3 will start with, read-only: the handful of fields per column
 * that were filled in at intake (or read from the email). Replaces showing
 * three locked forms while the enquiry is still waiting for a decision.
 */
export function CapturedPreview({ client }: { client: ClientDetail }) {
  const property: Property | undefined = client.properties[0];
  const openCase = client.cases.find((item) => item.status === "active");

  const columns: Array<{ title: string; icon: typeof User; rows: Row[]; note?: string }> = [
    {
      title: "Client",
      icon: User,
      rows: [
        { label: "Name", value: client.name },
        { label: "Email", value: client.email },
        { label: "Phone", value: client.phone || null },
        { label: "Company", value: client.companyName || null },
      ],
      note: `${client.onboarding.completed} of ${client.onboarding.total} onboarding items`,
    },
    {
      title: "Property",
      icon: Home,
      rows: property
        ? [
            { label: "Address", value: property.address },
            { label: "Value", value: money(property.value) },
            { label: "Loan", value: money(property.loanAmount) },
            { label: "Rent", value: property.rent ? `${formatMoney(property.rent)}/mo` : null },
          ]
        : [{ label: "Address", value: null }, { label: "Value", value: null }, { label: "Loan", value: null }],
      note: property ? undefined : "Nothing read from the enquiry",
    },
    {
      title: "Case",
      icon: Briefcase,
      rows: openCase
        ? [
            { label: "Reference", value: openCase.reference },
            { label: "Stage", value: openCase.stage },
            { label: "Loan", value: money(openCase.loanAmount) },
          ]
        : [
            { label: "Wants", value: enquiryTypeLabel(client.enquiryType) },
            { label: "Timescale", value: client.enquiryTimescale ?? null },
            { label: "Service level", value: null },
          ],
      note: openCase ? undefined : "Created at step 3",
    },
  ];

  return (
    <section className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Already captured
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        {columns.map((column) => {
          const filled = column.rows.filter((row) => row.value).length;
          return (
            <div key={column.title} className="rounded-lg border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <column.icon className="size-4 text-muted-foreground" />
                  {column.title}
                </span>
                <span className="text-xs text-muted-foreground">
                  {filled}/{column.rows.length}
                </span>
              </div>
              <dl className="mt-3 space-y-1.5">
                {column.rows.map((row) => (
                  <Pair key={row.label} label={row.label} empty={!row.value}>
                    {row.value ?? "—"}
                  </Pair>
                ))}
              </dl>
              {column.note ? (
                <p className="mt-3 text-xs text-muted-foreground">{column.note}</p>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Pair({ label, empty, children }: { label: string; empty: boolean; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-2 text-sm">
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 truncate", empty && "text-muted-foreground/60")}>{children}</dd>
    </div>
  );
}
