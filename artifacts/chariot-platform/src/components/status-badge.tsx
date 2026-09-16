import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { StatusStyle } from "@/lib/case-status";

type StatusBadgeProps = Omit<
  React.ComponentProps<typeof Badge>,
  "variant" | "children" | "style"
> & {
  style: StatusStyle;
};

/** Pastel pill with a tone dot — legible on light cards and coloured bands alike. */
export function StatusBadge({ style, className, ...props }: StatusBadgeProps) {
  return (
    <Badge
      variant="secondary"
      className={cn(style.className, className)}
      {...props}
    >
      <span
        className={cn("size-1.5 shrink-0 rounded-full", style.dotClassName)}
        aria-hidden="true"
      />
      {style.label}
    </Badge>
  );
}
