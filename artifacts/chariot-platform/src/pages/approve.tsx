import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { useRespondApprovalByToken, type PublicApprovalResult } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Spinner } from "@/components/ui/spinner";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The one-click Approve / Confirm link from a client email. No sign-in, no
 * form: the token in the URL is the credential and it works once.
 */
export default function ApprovePage() {
  const [, setLocation] = useLocation();
  const respond = useRespondApprovalByToken();
  const [result, setResult] = useState<PublicApprovalResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setError("This link is missing its code. Please use the button in your email.");
      return;
    }
    respond.mutate(
      { token, data: { response: "approved" } },
      {
        onSuccess: setResult,
        onError: (err) =>
          setError((err as { data?: { error?: string } })?.data?.error ?? "This link is no longer valid. Please ask your adviser to send it again."),
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const what = result?.kind === "advice" ? "advice" : "details";

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <Avatar className="mb-2 size-12 bg-primary/10 text-primary">
            <AvatarFallback className="bg-transparent">
              {error ? <CircleAlert className="size-6" /> : result ? <CheckCircle2 className="size-6" /> : <Spinner />}
            </AvatarFallback>
          </Avatar>
          <CardTitle className="text-2xl">
            {error ? "Link not valid" : result ? (result.status === "recorded" ? "Thank you" : "Already recorded") : "One moment…"}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center text-sm text-muted-foreground">
          {error
            ? error
            : result
              ? result.status === "recorded"
                ? `${result.firstName ? `${result.firstName}, ` : ""}your ${what === "advice" ? "approval of the advice" : "confirmation of the details"} has been recorded. Your adviser will take it from here.`
                : `Your answer on the ${what} was already recorded — nothing more to do.`
              : "Recording your answer."}
        </CardContent>
        <CardFooter className="justify-center border-t">
          <Button variant="link" onClick={() => setLocation("/login")} className="text-muted-foreground">
            Open your client portal
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
