import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useActivatePortal } from "@workspace/api-client-react";
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
import { toast } from "@/components/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";

export default function ActivatePage() {
  const [, setLocation] = useLocation();
  const [token, setToken] = useState<string>("");
  const activate = useActivatePortal();
  const qc = useQueryClient();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenParam = params.get("token");
    if (tokenParam) {
      setToken(tokenParam);
    } else {
      toast.add({
        title: "Invalid Link",
        description: "No activation token found in the URL.",
        type: "error",
      });
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!token) {
      setError("Activation token is missing.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    activate.mutate(
      { data: { token, password } },
      {
        onSuccess: (user) => {
          toast.add({
            title: "Account activated successfully",
            type: "success",
          });
          qc.clear(); // clear cache so we fetch new user data
          setLocation("/portal");
        },
        onError: (err: any) => {
          setError(
            err.message ||
              "Failed to activate account. The link may have expired.",
          );
        },
      },
    );
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <Avatar className="size-12 mb-2 bg-primary/10 text-primary">
            <AvatarFallback className="bg-transparent">
              <ShieldCheck className="size-6" />
            </AvatarFallback>
          </Avatar>
          <CardTitle className="text-2xl">Activate Account</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="password">New Password</FieldLabel>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="confirmPassword">
                  Confirm Password
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
                <p className="text-sm font-medium text-destructive">{error}</p>
              )}
              <Button
                type="submit"
                className="w-full mt-2"
                disabled={activate.isPending || !token}
              >
                {activate.isPending ? <Spinner /> : null}
                Activate Account
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
        <CardFooter className="justify-center border-t">
          <Button
            variant="link"
            onClick={() => setLocation("/login")}
            className="text-muted-foreground"
          >
            Already activated? Log in here.
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
