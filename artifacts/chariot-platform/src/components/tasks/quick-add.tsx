import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { format } from "date-fns";
import {
  getListCasesQueryKey,
  useListCases,
  type Case,
  type StaffUser,
  type TaskInput,
} from "@workspace/api-client-react";
import {
  Briefcase,
  CalendarDays,
  Flag,
  Plus,
  UserRound,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAuth } from "@/components/auth-provider";
import { isFullAccess } from "@/lib/roles";
import {
  TASK_PRIORITIES,
  formatDateKey,
  parseQuickAdd,
  priorityClass,
  priorityLabel,
  todayKey,
  type TaskPriority,
} from "./task-model";

export interface QuickAddHandle {
  focus: () => void;
}

export interface QuickAddProps {
  staff: StaffUser[];
  /** Fix the task to one case (the case side panel) and hide the case chip. */
  caseId?: number | null;
  /** Assignee to preselect when the current view is filtered to one person. */
  defaultAssigneeId?: number | null;
  onCreate: (input: TaskInput, reset: () => void) => void;
  pending?: boolean;
  className?: string;
}

/**
 * One-line task capture. Type a title with optional inline tokens
 * (`tomorrow`, `!urgent`, `@name`) and press Enter; the chips underneath show
 * what was understood and can be changed before submitting.
 */
export const QuickAdd = forwardRef<QuickAddHandle, QuickAddProps>(
  function QuickAdd(
    {
      staff,
      caseId = null,
      defaultAssigneeId = null,
      onCreate,
      pending = false,
      className,
    },
    ref,
  ) {
    const { user } = useAuth();
    const isAdmin = isFullAccess(user?.role);
    const { data: cases } = useListCases(undefined, {
      query: { enabled: caseId === null, queryKey: getListCasesQueryKey() },
    });
    const inputRef = useRef<HTMLInputElement>(null);
    useImperativeHandle(
      ref,
      () => ({ focus: () => inputRef.current?.focus() }),
      [],
    );

    const [text, setText] = useState("");
    const [focused, setFocused] = useState(false);
    // Chip overrides win over anything parsed from the text.
    const [priority, setPriority] = useState<TaskPriority | null>(null);
    const [dueDate, setDueDate] = useState<string | null>(null);
    const [assigneeId, setAssigneeId] = useState<number | null>(null);
    const [chipCase, setChipCase] = useState<Case | null>(null);
    const [dateOpen, setDateOpen] = useState(false);
    const [caseOpen, setCaseOpen] = useState(false);

    const parsed = useMemo(() => parseQuickAdd(text), [text]);
    const parsedAssignee = useMemo(() => {
      if (!parsed.assigneeQuery || !isAdmin) return null;
      const query = parsed.assigneeQuery.toLowerCase();
      return (
        staff.find((member) =>
          member.displayName
            .toLowerCase()
            .replace(/\s+/g, "")
            .startsWith(query),
        ) ?? null
      );
    }, [parsed.assigneeQuery, staff, isAdmin]);

    const effectivePriority = priority ?? parsed.priority ?? "normal";
    const effectiveDue = dueDate ?? parsed.dueDate ?? todayKey();
    const effectiveAssigneeId = isAdmin
      ? (assigneeId ??
        parsedAssignee?.id ??
        defaultAssigneeId ??
        user?.id ??
        null)
      : (user?.id ?? null);
    const effectiveAssignee =
      staff.find((member) => member.id === effectiveAssigneeId) ?? null;
    const assigneeName =
      effectiveAssignee?.displayName ??
      (effectiveAssigneeId === user?.id ? user?.displayName : null);

    const reset = () => {
      setText("");
      setPriority(null);
      setDueDate(null);
      setAssigneeId(null);
      setChipCase(null);
    };

    const submit = () => {
      const title = parsed.title.trim();
      if (!title || !effectiveAssigneeId || pending) return;
      onCreate(
        {
          title,
          priority: effectivePriority,
          dueDate: effectiveDue,
          assignedUserId: effectiveAssigneeId,
          caseId: caseId ?? chipCase?.id ?? null,
          notes: "",
        },
        reset,
      );
    };

    const expanded = focused || text.length > 0;
    const priorityColor = priorityClass(effectivePriority);

    return (
      <div
        className={cn("space-y-2", className)}
        onFocusCapture={() => setFocused(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setFocused(false);
        }}
      >
        <InputGroup>
          <InputGroupAddon>
            <Plus />
          </InputGroupAddon>
          <InputGroupInput
            ref={inputRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              } else if (event.key === "Escape") {
                reset();
                event.currentTarget.blur();
              }
            }}
            placeholder={
              isAdmin
                ? "Add a task… e.g. “Chase valuation friday !high @sam”"
                : "Add a task… e.g. “Chase valuation friday !high”"
            }
            aria-label="New task"
            disabled={pending}
          />
          <InputGroupAddon align="inline-end">
            {text ? (
              <Button
                variant="default"
                size="xs"
                onClick={submit}
                disabled={!parsed.title.trim() || pending}
              >
                Add
              </Button>
            ) : (
              <Kbd>N</Kbd>
            )}
          </InputGroupAddon>
        </InputGroup>

        {expanded && (
          <div
            className="flex flex-wrap items-center gap-1.5 px-1"
            aria-label="New task options"
          >
            <Popover open={dateOpen} onOpenChange={setDateOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="xs"
                  aria-label={`Due ${formatDateKey(effectiveDue)}`}
                >
                  <CalendarDays />
                  {effectiveDue === todayKey()
                    ? "Today"
                    : formatDateKey(effectiveDue)}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={new Date(`${effectiveDue}T00:00:00`)}
                  defaultMonth={new Date(`${effectiveDue}T00:00:00`)}
                  onSelect={(selected) => {
                    if (selected) setDueDate(format(selected, "yyyy-MM-dd"));
                    setDateOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="xs"
                  aria-label={`Priority ${priorityLabel(effectivePriority)}`}
                >
                  <Flag
                    className={cn(priorityColor)}
                    fill={priorityColor ? "currentColor" : "none"}
                  />
                  {priorityLabel(effectivePriority)}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuRadioGroup
                  value={effectivePriority}
                  onValueChange={(value) => setPriority(value as TaskPriority)}
                >
                  {TASK_PRIORITIES.map((item) => (
                    <DropdownMenuRadioItem key={item.value} value={item.value}>
                      <Flag
                        className={cn(
                          "size-3.5",
                          item.className ?? "text-muted-foreground",
                        )}
                        fill={item.className ? "currentColor" : "none"}
                      />
                      {item.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            {isAdmin && staff.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="xs"
                    aria-label={`Assignee ${assigneeName ?? "unset"}`}
                  >
                    <UserRound />
                    {effectiveAssigneeId === user?.id
                      ? "Me"
                      : (assigneeName ?? "Assignee")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuRadioGroup
                    value={
                      effectiveAssigneeId ? String(effectiveAssigneeId) : ""
                    }
                    onValueChange={(value) => setAssigneeId(Number(value))}
                  >
                    {staff.map((member) => (
                      <DropdownMenuRadioItem
                        key={member.id}
                        value={String(member.id)}
                      >
                        {member.displayName}
                        {member.id === user?.id && (
                          <span className="text-muted-foreground"> (me)</span>
                        )}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {caseId === null &&
              (chipCase ? (
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => setChipCase(null)}
                  aria-label="Remove case"
                >
                  <Briefcase />
                  {chipCase.reference}
                  <X />
                </Button>
              ) : (
                <Popover open={caseOpen} onOpenChange={setCaseOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="xs"
                      aria-label="Link a case"
                    >
                      <Briefcase />
                      Link a case
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search cases…" />
                      <CommandList>
                        <CommandEmpty>No cases found.</CommandEmpty>
                        <CommandGroup>
                          {(cases ?? []).map((c) => (
                            <CommandItem
                              key={c.id}
                              value={`${c.reference} ${c.clientName}`}
                              onSelect={() => {
                                setChipCase(c);
                                setCaseOpen(false);
                              }}
                            >
                              {c.reference}
                              <span className="text-muted-foreground">
                                {" "}
                                · {c.clientName}
                              </span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              ))}

            {text && (
              <Button
                variant="ghost"
                size="xs"
                className="ml-auto"
                onClick={reset}
              >
                Clear
              </Button>
            )}
          </div>
        )}
      </div>
    );
  },
);
