import * as React from "react";
import { Check, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAssistantConfig } from "./config";
import { TypeTile } from "./record-card";
import type { Answer, PendingQuestion } from "./types";

const OTHER = "__other__";

/**
 * "Which case do you mean?" as a dropdown of the candidates the assistant
 * found, instead of a question in prose. Record options link to the record.
 */
function QuestionCard({
  pending,
  answered,
  onAnswer,
  disabled,
}: {
  pending: PendingQuestion;
  answered: Answer | undefined;
  onAnswer: (answer: Answer) => void;
  disabled?: boolean;
}) {
  const { Link, recordHref } = useAssistantConfig();
  const { question } = pending;
  const [value, setValue] = React.useState<string>("");
  const [other, setOther] = React.useState("");
  const chosen = question.options.find((option) => option.value === value);
  const canConfirm = value === OTHER ? other.trim().length > 0 : !!chosen;

  const confirm = () => {
    if (!canConfirm) return;
    onAnswer(
      value === OTHER
        ? { value: other.trim(), label: other.trim() }
        : { value: chosen!.value, label: chosen!.label },
    );
  };

  return (
    <Card
      className="w-full max-w-md gap-3 py-3"
      data-testid="assistant-question"
    >
      <CardHeader className="px-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <HelpCircle className="size-4 text-primary" />
          <span>{question.question}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 px-3">
        {answered ? (
          <div className="text-sm">
            <Check className="mr-1 inline size-3.5 text-primary" />
            {answered.label ?? answered.value}
          </div>
        ) : (
          <>
            <Select value={value} onValueChange={setValue} disabled={disabled}>
              <SelectTrigger
                className="w-full"
                aria-label="Choose an option"
                data-testid="assistant-question-select"
              >
                <SelectValue placeholder="Choose…" />
              </SelectTrigger>
              <SelectContent>
                {question.options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.type && (
                      <TypeTile
                        type={option.type}
                        className="size-5 rounded-sm [&_svg]:size-3"
                      />
                    )}
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{option.label}</span>
                      {option.detail && (
                        <span className="truncate text-xs text-muted-foreground">
                          {option.detail}
                        </span>
                      )}
                    </span>
                  </SelectItem>
                ))}
                {question.allowFreeText && (
                  <SelectItem value={OTHER}>Something else…</SelectItem>
                )}
              </SelectContent>
            </Select>
            {value === OTHER && (
              <Input
                autoFocus
                placeholder="Type your answer"
                value={other}
                onChange={(event) => setOther(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") confirm();
                }}
              />
            )}
            {chosen?.type && chosen.id != null && (
              <Link
                href={recordHref(chosen.type, chosen.id)}
                className="self-start text-xs text-primary hover:underline"
              >
                Open {chosen.label}
              </Link>
            )}
          </>
        )}
      </CardContent>
      {!answered && (
        <CardFooter className="justify-end px-3">
          <Button
            size="sm"
            disabled={disabled || !canConfirm}
            onClick={confirm}
          >
            <Check />
            Confirm
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

export { QuestionCard };
