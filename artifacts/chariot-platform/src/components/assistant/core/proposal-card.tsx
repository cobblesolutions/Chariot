import { Check, ShieldAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAssistantConfig } from "./config";
import { TypeTile } from "./record-card";
import type { Proposal } from "./types";

/**
 * A write the assistant wants to make, shown with the exact fields it will
 * change so someone can approve or decline it before anything is saved.
 */
function ProposalCard({
  proposal,
  decision,
  onDecide,
  disabled,
}: {
  proposal: Proposal;
  decision: boolean | undefined;
  onDecide: (approved: boolean) => void;
  disabled?: boolean;
}) {
  const { Link } = useAssistantConfig();
  const { preview } = proposal;
  const decided = decision !== undefined;

  return (
    <Card
      className={cn(
        "w-full max-w-md gap-3 py-3",
        preview.destructive && "border-destructive/40",
        decision === true && "border-primary/50",
        decision === false && "opacity-70",
      )}
      data-testid="assistant-proposal"
    >
      <CardHeader className="px-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          {preview.destructive ? (
            <ShieldAlert className="size-4 text-destructive" />
          ) : preview.target ? (
            <TypeTile
              type={preview.target.type}
              className="size-6 [&_svg]:size-3.5"
            />
          ) : null}
          <span className="truncate">{preview.title}</span>
          <Badge
            variant={preview.destructive ? "destructive" : "secondary"}
            className="ml-auto shrink-0"
          >
            Needs approval
          </Badge>
        </CardTitle>
        <CardDescription className="text-xs">
          {preview.target?.href ? (
            <>
              {preview.summary
                .replace(preview.target.title, "")
                .replace(/[:\s]+$/, "")}
              {": "}
              <Link
                href={preview.target.href}
                className="font-medium text-primary hover:underline"
              >
                {preview.target.title}
              </Link>
            </>
          ) : (
            preview.summary
          )}
        </CardDescription>
      </CardHeader>
      {preview.changes.length > 0 && (
        <CardContent className="px-0">
          <Table className="text-xs">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="h-7 px-3">Field</TableHead>
                <TableHead className="h-7 px-3">Current</TableHead>
                <TableHead className="h-7 px-3">New</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.changes.map((change, index) => (
                <TableRow key={`${change.field}-${index}`}>
                  <TableCell className="px-3 py-1.5 font-medium">
                    {change.field}
                  </TableCell>
                  <TableCell className="max-w-32 truncate px-3 py-1.5 text-muted-foreground">
                    {change.from ?? "—"}
                  </TableCell>
                  <TableCell className="max-w-40 px-3 py-1.5 whitespace-pre-wrap">
                    {change.to ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      )}
      <CardFooter className="justify-end gap-2 px-3">
        {decided ? (
          <span className="text-xs text-muted-foreground">
            {decision ? "Approved" : "Declined"}
          </span>
        ) : (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => onDecide(false)}
            >
              <X />
              Decline
            </Button>
            <Button
              variant={preview.destructive ? "destructive" : "default"}
              size="sm"
              disabled={disabled}
              onClick={() => onDecide(true)}
            >
              <Check />
              Approve
            </Button>
          </>
        )}
      </CardFooter>
    </Card>
  );
}

export { ProposalCard };
