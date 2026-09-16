import type { ReactNode } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { FieldGroup } from "@/components/ui/field";

/** Count of non-empty values, for the "3/5" badge in a section header. */
export function countFilled(values: Array<string | boolean | null | undefined>) {
  return values.filter((value) =>
    typeof value === "boolean" ? value : !!value && value.trim() !== "",
  ).length;
}

/**
 * Collapsible groups of fields. All start closed and only one is open at a
 * time: opening a section closes the previous one.
 */
export function FormSections({
  defaultOpen,
  children,
}: {
  defaultOpen?: string;
  children: ReactNode;
}) {
  return (
    <Accordion
      type="single"
      collapsible
      defaultValue={defaultOpen}
      className="w-full"
    >
      {children}
    </Accordion>
  );
}

export function FormSection({
  id,
  title,
  filled,
  total,
  hint,
  children,
}: {
  id: string;
  title: string;
  filled?: number;
  total?: number;
  hint?: string;
  children: ReactNode;
}) {
  const complete = total != null && filled != null && filled >= total;
  return (
    <AccordionItem value={id}>
      <AccordionTrigger className="-mx-3 px-3 py-3 hover:no-underline">
        <span className="flex flex-1 items-center justify-between gap-3 pr-2">
          <span className="text-sm font-semibold">{title}</span>
          {total != null ? (
            <span
              className={
                complete
                  ? "text-xs font-medium text-emerald-600"
                  : "text-xs text-muted-foreground"
              }
            >
              {filled}/{total}
            </span>
          ) : null}
        </span>
      </AccordionTrigger>
      <AccordionContent className="pb-4">
        {hint ? (
          <p className="mb-3 text-sm text-muted-foreground">{hint}</p>
        ) : null}
        <FieldGroup className="gap-4">{children}</FieldGroup>
      </AccordionContent>
    </AccordionItem>
  );
}
