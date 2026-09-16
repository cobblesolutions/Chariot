import { useListDefaultAssignees } from "@workspace/api-client-react";
import { UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SUBMISSION_STAGE_INDEX,
  stageSection,
  type SubmissionStepSection,
} from "@/lib/stages";

/**
 * Who is responsible for one Submission step by default, resolved the same
 * way the API does (step → Submission stage → Case). Renders nothing when
 * no one is configured at any level, so the role fallback stays implicit.
 */
export function SubmissionStepOwner({
  section,
  className,
}: {
  section: SubmissionStepSection;
  className?: string;
}) {
  const { data: defaults } = useListDefaultAssignees();
  const nameOf = (key: string) =>
    defaults?.find((item) => item.section === key)?.displayName ?? null;
  const name =
    nameOf(section) ??
    nameOf(stageSection(SUBMISSION_STAGE_INDEX)) ??
    nameOf("case");
  if (!name) return null;
  return (
    <span
      title="Default owner of this step — set in Settings › Default Assignees"
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium leading-none text-violet-800 dark:bg-violet-900/50 dark:text-violet-200",
        className,
      )}
    >
      <UserRound className="size-3" />
      {name}
    </span>
  );
}
