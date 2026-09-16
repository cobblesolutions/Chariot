import { useState } from "react";
import { useLocation } from "wouter";
import { useForgotPassword } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Spinner } from "@/components/ui/spinner";
import { Field, FieldLabel, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { KeyRound, MailCheck } from "lucide-react";

export default function ForgotPasswordPage() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const forgotPassword = useForgotPassword();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    forgotPassword.mutate(
      { data: { email } },
      { onSuccess: () => setSubmitted(true) },
    );
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <Avatar className="size-12 mb-2 bg-primary/10 text-primary">
            <AvatarFallback className="bg-transparent">
              {submitted ? (
                <MailCheck className="size-6" />
              ) : (
                <KeyRound className="size-6" />
              )}
            </AvatarFallback>
          </Avatar>
          <CardTitle className="text-2xl">Reset your password</CardTitle>
        </CardHeader>
        {!submitted && (
          <CardContent>
            <form onSubmit={handleSubmit}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="email">Email address</FieldLabel>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </Field>
                <Button
                  type="submit"
                  className="w-full mt-2"
                  disabled={forgotPassword.isPending}
                >
                  {forgotPassword.isPending ? <Spinner /> : null}
                  Send reset link
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        )}
        <CardFooter className="justify-center border-t">
          <Button
            variant="link"
            onClick={() => setLocation("/login")}
            className="text-muted-foreground"
          >
            Back to log in
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
