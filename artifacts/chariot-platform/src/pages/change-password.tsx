import { useState } from "react";
import { useLocation } from "wouter";
import { useChangePassword } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/back-button";
import { Spinner } from "@/components/ui/spinner";
import { Field, FieldLabel, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { KeyRound } from "lucide-react";
import { useAuth } from "@/components/auth-provider";

export default function ChangePasswordPage() {
  const [, setLocation] = useLocation();
  const changePassword = useChangePassword();
  const { user } = useAuth();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const minimumPasswordLength = user?.role === "client" ? 8 : 12;
    if (newPassword.length < minimumPasswordLength) {
      setError(
        `New password must be at least ${minimumPasswordLength} characters long.`,
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    changePassword.mutate(
      { data: { currentPassword, newPassword } },
      {
        onSuccess: () => {
          toast.add({
            title: "Password changed successfully",
            type: "success",
          });
          setLocation(user?.role === "client" ? "/portal" : "/dashboard");
        },
        onError: (err: any) => {
          setError(
            err.message ||
              "Failed to change password. Please check your current password.",
          );
        },
      },
    );
  };

  const isClient = user?.role === "client";

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-page mx-auto">
      <div>
        <BackButton
          className="mb-4 -ml-3"
          fallback={
            isClient
              ? { href: "/portal", label: "Portal" }
              : { href: "/dashboard", label: "Dashboard" }
          }
        />
        <h1 className="text-3xl font-bold tracking-tight">Change Password</h1>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-5 text-primary" /> Security Settings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="max-w-md">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="currentPassword">
                  Current Password
                </FieldLabel>
                <Input
                  id="currentPassword"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </Field>
              <div className="space-y-2 pt-2">
                <Label htmlFor="newPassword">New Password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={
                    user?.role === "client"
                      ? "Minimum 8 characters"
                      : "Minimum 12 characters"
                  }
                  required
                />
              </div>
              <Field>
                <FieldLabel htmlFor="confirmPassword">
                  Confirm New Password
                </FieldLabel>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </Field>

              {error && (
                <p className="text-sm font-medium text-destructive mt-2">
                  {error}
                </p>
              )}

              <div className="pt-4">
                <Button type="submit" disabled={changePassword.isPending}>
                  {changePassword.isPending ? <Spinner /> : null}
                  Update Password
                </Button>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
