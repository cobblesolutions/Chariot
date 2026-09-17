import { useEffect, useRef, useState } from "react";
import {
  useListStageThresholds,
  useUpdateStageThreshold,
  getListStageThresholdsQueryKey,
  useListDefaultAssignees,
  useUpdateDefaultAssignee,
  getListDefaultAssigneesQueryKey,
  useListStaff,
  type DefaultAssignee,
  type DefaultAssigneeSection,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FileSignature, Flag, UserCheck, Users } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { AssigneePicker, type AssigneeStaff } from "@/components/assignee-picker";
import { useAuth } from "@/components/auth-provider";
import { isFullAccess, ROLE_LABELS, type StaffRole } from "@/lib/roles";
import {
  CASE_STAGES,
  SUBMISSION_STEPS,
  stageClasses,
  stageOwnerRole,
  stageSection,
  SUBMISSION_STAGE_INDEX,
} from "@/lib/stages";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UsersTab } from "@/components/settings/users-tab";
import { TermsOfBusinessTab } from "@/components/settings/terms-of-business-tab";
import { SubmissionStepThresholds } from "@/components/settings/submission-step-thresholds";
import { useSearch } from "wouter";

const assigneeSections: Array<{
  section: DefaultAssigneeSection;
  label: string;
}> = [
  { section: "client", label: "Client" },
  { section: "property", label: "Property" },
  { section: "case", label: "Case" },
];

const ROLE_DEFAULT_VALUE = "__none__";

const roleDefaultLabel = (role: StaffRole) =>
  `Role default (${ROLE_LABELS[role]})`;

function AssigneeRow({
  label,
  leadingLabel,
  value,
  onChange,
  disabled,
  saving,
  staff,
  indent,
  dot,
}: {
  label: string;
  leadingLabel: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  saving: boolean;
  staff: AssigneeStaff[];
  indent?: boolean;
  dot?: string;
}) {
  return (
    <div
      className={`flex flex-col gap-3 py-3 pr-5 sm:flex-row sm:items-center sm:justify-between ${
        indent ? "pl-10 bg-muted/30" : "pl-5"
      }`}
    >
      <div className="flex min-w-0 items-start gap-2">
        {dot && (
          <span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${dot}`} />
        )}
        <p className="min-w-0 text-sm font-medium text-foreground">{label}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <AssigneePicker
          value={value}
          onValueChange={onChange}
          disabled={disabled}
          staff={staff}
          leading={[{ value: ROLE_DEFAULT_VALUE, label: leadingLabel }]}
          className="w-full sm:w-[22rem]"
        />
        <span className="text-xs text-muted-foreground w-12">
          {saving ? "saving…" : ""}
        </span>
      </div>
    </div>
  );
}

function DefaultAssigneesTab({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const { data: defaults, isLoading } = useListDefaultAssignees();
  const { data: staff } = useListStaff();
  const updateDefault = useUpdateDefaultAssignee();
  const [savingSection, setSavingSection] =
    useState<DefaultAssigneeSection | null>(null);

  const rowFor = (section: DefaultAssigneeSection) =>
    defaults?.find((item) => item.section === section);
  const valueOf = (section: DefaultAssigneeSection) => {
    const current = rowFor(section);
    return current?.userId != null
      ? String(current.userId)
      : ROLE_DEFAULT_VALUE;
  };
  // Mirrors the server-side inheritance: stage → case; submission step → stage → case.
  const caseDefaultName = rowFor("case")?.displayName ?? null;
  const stageLeadingLabel = (stageIndex: number) =>
    caseDefaultName
      ? `Case default · ${caseDefaultName}`
      : roleDefaultLabel(stageOwnerRole(stageIndex));
  const submissionOwnerName =
    rowFor(stageSection(SUBMISSION_STAGE_INDEX))?.displayName ??
    caseDefaultName;
  const stepLeadingLabel = submissionOwnerName
    ? `Submission stage · ${submissionOwnerName}`
    : roleDefaultLabel(stageOwnerRole(SUBMISSION_STAGE_INDEX));

  const commit = (section: DefaultAssigneeSection, raw: string) => {
    const userId = raw === ROLE_DEFAULT_VALUE ? null : parseInt(raw, 10);
    const current = rowFor(section)?.userId ?? null;
    if (current === userId) return;
    setSavingSection(section);
    updateDefault.mutate(
      { section, data: { userId } },
      {
        onSuccess: (saved) => {
          qc.setQueryData(
            getListDefaultAssigneesQueryKey(),
            (existing: DefaultAssignee[] | undefined) =>
              existing?.map((item) =>
                item.section === section ? saved : item,
              ),
          );
          qc.invalidateQueries({ queryKey: getListDefaultAssigneesQueryKey() });
        },
        onError: () =>
          toast.add({
            title: "Failed to save default assignee",
            type: "error",
          }),
        onSettled: () =>
          setSavingSection((value) => (value === section ? null : value)),
      },
    );
  };

  const rowProps = (section: DefaultAssigneeSection) => ({
    value: valueOf(section),
    onChange: (value: string) => commit(section, value),
    disabled: !isAdmin || savingSection === section,
    saving: savingSection === section,
    staff: staff ?? [],
  });

  const loading = (
    <div className="p-5 space-y-3">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );

  return (
    <TabsContent value="default-assignees" className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Defaults inherit from the level above; staff can still pick someone
        else on the Add page.
      </p>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Adding records</h2>
        <Card className="gap-0 overflow-hidden py-0">
          {isLoading ? (
            loading
          ) : (
            <div className="divide-y">
              {assigneeSections.map(({ section, label }) => (
                <AssigneeRow
                  key={section}
                  label={label}
                  leadingLabel={roleDefaultLabel("case_manager")}
                  {...rowProps(section)}
                />
              ))}
            </div>
          )}
        </Card>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Pipeline stages</h2>
        <Card className="gap-0 overflow-hidden py-0">
          {isLoading ? (
            loading
          ) : (
            <div className="divide-y">
              {CASE_STAGES.map((stage, stageIndex) => (
                <div key={stage} className="divide-y">
                  <AssigneeRow
                    label={stage}
                    leadingLabel={stageLeadingLabel(stageIndex)}
                    dot={stageClasses(stageIndex).bg}
                    {...rowProps(stageSection(stageIndex))}
                  />
                  {stageIndex === SUBMISSION_STAGE_INDEX &&
                    SUBMISSION_STEPS.map((step) => (
                      <AssigneeRow
                        key={step.section}
                        indent
                        label={step.label}
                        leadingLabel={stepLeadingLabel}
                        {...rowProps(step.section)}
                      />
                    ))}
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>

      {!isAdmin && (
        <p className="text-xs text-muted-foreground italic">
          Only administrators can change default assignees.
        </p>
      )}
    </TabsContent>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = isFullAccess(user?.role);
  const qc = useQueryClient();
  const { data: thresholds, isLoading } = useListStageThresholds();
  const updateThreshold = useUpdateStageThreshold();

  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [savedIndex, setSavedIndex] = useState<number | null>(null);
  const saveTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    if (thresholds) {
      const next: Record<number, string> = {};
      thresholds.forEach((t) => {
        next[t.stageIndex] =
          t.thresholdDays != null ? String(t.thresholdDays) : "";
      });
      setDrafts(next);
    }
  }, [thresholds]);

  useEffect(() => {
    return () => {
      Object.values(saveTimers.current).forEach(clearTimeout);
    };
  }, []);

  const commitThreshold = (stageIndex: number, raw: string) => {
    const thresholdDays = raw.trim() === "" ? null : parseInt(raw, 10);
    if (thresholdDays != null && (isNaN(thresholdDays) || thresholdDays < 1)) {
      toast.add({
        title: "Enter a whole number of days, or leave blank to never flag",
        type: "error",
      });
      return;
    }
    const current =
      thresholds?.find((t) => t.stageIndex === stageIndex)?.thresholdDays ??
      null;
    if (current === thresholdDays) return;
    setSavingIndex(stageIndex);
    setSavedIndex(null);
    updateThreshold.mutate(
      { stageIndex, data: { thresholdDays } },
      {
        onSuccess: (saved) => {
          qc.setQueryData(
            getListStageThresholdsQueryKey(),
            (current: typeof thresholds) =>
              current?.map((threshold) =>
                threshold.stageIndex === stageIndex
                  ? { ...threshold, thresholdDays: saved.thresholdDays }
                  : threshold,
              ),
          );
          setDrafts((current) => ({
            ...current,
            [stageIndex]:
              saved.thresholdDays == null ? "" : String(saved.thresholdDays),
          }));
          setSavedIndex(stageIndex);
          qc.invalidateQueries({ queryKey: getListStageThresholdsQueryKey() });
        },
        onError: () => {
          toast.add({ title: "Failed to save threshold", type: "error" });
        },
        onSettled: () =>
          setSavingIndex((current) =>
            current === stageIndex ? null : current,
          ),
      },
    );
  };

  const handleDraftChange = (stageIndex: number, value: string) => {
    setDrafts((d) => ({ ...d, [stageIndex]: value }));
    if (saveTimers.current[stageIndex])
      clearTimeout(saveTimers.current[stageIndex]);
    saveTimers.current[stageIndex] = setTimeout(
      () => commitThreshold(stageIndex, value),
      600,
    );
  };

  // `/settings?tab=terms-of-business` deep-links a tab (from the case's Terms section).
  const requestedTab = new URLSearchParams(useSearch()).get("tab");
  const initialTab = requestedTab && ["stage-flagging", "default-assignees", "terms-of-business", "users"].includes(requestedTab) ? requestedTab : "stage-flagging";

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-page mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
      </div>

      <Tabs defaultValue={initialTab}>
        <TabsList>
          <TabsTrigger value="stage-flagging">
            <Flag />
            Stage Flagging
          </TabsTrigger>
          <TabsTrigger value="default-assignees">
            <UserCheck />
            Default Assignees
          </TabsTrigger>
          <TabsTrigger value="terms-of-business">
            <FileSignature />
            Terms of Business
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="users">
              <Users />
              Users
            </TabsTrigger>
          )}
        </TabsList>

        <DefaultAssigneesTab isAdmin={isAdmin} />
        <TermsOfBusinessTab isAdmin={isAdmin} />
        <UsersTab isAdmin={isAdmin} />

        <TabsContent value="stage-flagging" className="space-y-4">
          <Card className="gap-0 overflow-hidden py-0">
            {isLoading ? (
              <div className="p-5 space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <div className="divide-y">
                {thresholds?.map((t) => (
                  <div
                    key={t.stageIndex}
                    className="flex items-center justify-between gap-4 px-5 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className={`size-2.5 shrink-0 rounded-full ${stageClasses(t.stageIndex).bg}`}
                      />
                      <p className="text-sm font-medium text-foreground truncate">
                        {t.stage}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Input
                        type="number"
                        min={1}
                        inputMode="numeric"
                        placeholder="0"
                        disabled={!isAdmin}
                        value={drafts[t.stageIndex] ?? ""}
                        onChange={(e) =>
                          handleDraftChange(t.stageIndex, e.target.value)
                        }
                        onBlur={(e) => {
                          if (saveTimers.current[t.stageIndex])
                            clearTimeout(saveTimers.current[t.stageIndex]);
                          commitThreshold(t.stageIndex, e.target.value);
                        }}
                        className="w-16 text-right"
                      />
                      <span className="text-xs text-muted-foreground w-10">
                        {savingIndex === t.stageIndex
                          ? "saving…"
                          : savedIndex === t.stageIndex
                            ? "saved"
                            : "days"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <SubmissionStepThresholds isAdmin={isAdmin} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
