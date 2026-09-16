import { ChevronLeft } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useBackTarget, type BackTarget } from "@/lib/nav-history";

interface BackButtonProps
  extends Omit<React.ComponentProps<typeof Button>, "onClick" | "children"> {
  /** Where to go when the user arrived directly (deep link, fresh session). */
  fallback: BackTarget;
}

/**
 * "Back to <page the user came from>", falling back to the list page. Walks
 * real browser history when it can so forward navigation keeps working.
 */
export function BackButton({
  fallback,
  variant = "ghost",
  size = "sm",
  className,
  ...props
}: BackButtonProps) {
  const [, navigate] = useLocation();
  const target = useBackTarget(fallback);

  const goBack = () => {
    if (target.steps > 0) window.history.go(-target.steps);
    else navigate(target.href);
  };

  return (
    <Button
      variant={variant}
      size={size}
      onClick={goBack}
      className={cn("max-w-full", className)}
      {...props}
    >
      <ChevronLeft />
      <span className="truncate">Back to {target.label}</span>
    </Button>
  );
}
