import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { stageClasses } from "@/lib/stages";

type StageBadgeProps = Omit<React.ComponentProps<typeof Badge>, "variant"> & {
  stage: string;
  /** Pass when available; falls back to a name lookup otherwise. */
  stageIndex?: number;
};

/** Solid pill in the stage's pipeline colour. Used everywhere a stage is shown. */
export function StageBadge({
  stage,
  stageIndex,
  className,
  ...props
}: StageBadgeProps) {
  const { solid } = stageClasses(stageIndex ?? stage);
  return (
    <Badge variant="outline" className={cn(solid, className)} {...props}>
      {stage}
    </Badge>
  );
}
