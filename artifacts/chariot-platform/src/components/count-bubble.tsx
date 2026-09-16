import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Round "N new" pill used on the sidebar icons and page titles; hidden at zero. */
export function CountBubble({
  count,
  className,
  ...props
}: React.ComponentProps<typeof Badge> & { count: number }) {
  // `!(count > 0)` also hides NaN/undefined, which `count <= 0` would render as text.
  if (!(count > 0)) return null;
  return (
    <Badge
      className={cn(
        "h-5 min-w-5 justify-center rounded-full px-1.5 text-xs",
        className,
      )}
      {...props}
    >
      {count > 99 ? "99+" : count}
    </Badge>
  );
}
