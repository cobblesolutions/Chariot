import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useResetPassword } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Spinner } from "@/components/ui/spinner";
import { Field, FieldLabel, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { KeyRound, CheckCircle2 } from "lucide-react";

export default function ResetPasswordPage() {
  const [, setLocation] = useLocation();
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  // Staff setup links (Settings → Users) land here with ?setup=1 so the page
  // reads as first-time account setup rather than a reset.
  const [setup, setSetup] = useState(false);
  const resetPassword = useResetPassword();
  const minLength = setup ? 12 : 8;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenParam = params.get("token");
    if (tokenParam) setToken(tokenParam);
    else setError("No reset token found in the URL.");
    setSetup(params.get("setup") === "1");
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!token) {
      setError("Reset token is missing.");
      return;
    }
    if (password.length < minLength) {
      setError(`Password must be at least ${minLength} characters long.`);
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    resetPassword.mutate(
      { data: { token, password } },
      {
        onSuccess: () => setDone(true),
        onError: (err: any) =>
          setError(
            err.message ||
              "This reset link is invalid, expired, or has already been used.",
          ),
      },
    );
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <Avatar className="size-12 mb-2 bg-primary/10 text-primary">
            <AvatarFallback className="bg-transparent">
              {done ? (
                <CheckCircle2 className="size-6" />
              ) : (
                <KeyRound className="size-6" />
              )}
            </AvatarFallback>
          </Avatar>
          <CardTitle className="text-2xl">
            {done
              ? setup
                ? "Account ready"
                : "Password reset"
              : setup
                ? "Set up your account"
                : "Choose a new password"}
          </CardTitle>
          {done && (
            <CardDescription>
              {setup
                ? "Your password is set. Sign in to get started."
                : "Your password has been changed. Sign in with your new password."}
            </CardDescription>
          )}
        </CardHeader>
        {!done && (
          <CardContent>
            <form onSubmit={handleSubmit}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="password">
                    {setup ? "Password" : "New password"}
                  </FieldLabel>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={`Minimum ${minLength} characters`}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="confirmPassword">
                    Confirm password
                  </FieldLabel>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm your password"
                    required
                  />
                </Field>
                {error && (
                  <p className="text-sm font-medium text-destructive">
                    {error}
                  </p>
                )}
                <Button
                  type="submit"
                  className="w-full mt-2"
                  disabled={resetPassword.isPending || !token}
                >
                  {resetPassword.isPending ? <Spinner /> : null}
                  {setup ? "Set password" : "Reset password"}
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
