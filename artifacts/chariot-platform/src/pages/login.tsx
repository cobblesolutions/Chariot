import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocation } from "wouter";
import { Eye, EyeOff } from "lucide-react";
import {
  useLogin,
  getGetCurrentUserQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Button } from "@/components/ui/button";

const schema = z.object({
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export default function LoginPage() {
  const [location, setLocation] = useLocation();
  const qc = useQueryClient();
  const login = useLogin();
  const [showPassword, setShowPassword] = useState(false);
  const mode: "staff" | "portal" =
    location === "/staff/login" ? "staff" : "portal";

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  const onNavigateAfterLogin = (user: {
    mustChangePassword: boolean;
    role: string;
  }) => {
    const currentUserKey = getGetCurrentUserQueryKey();
    qc.removeQueries({
      predicate: (query) => query.queryKey[0] !== currentUserKey[0],
    });
    qc.setQueryData(currentUserKey, user);
    setLocation(
      user.mustChangePassword
        ? "/change-password"
        : user.role === "client"
          ? "/portal"
          : "/dashboard",
    );
  };

  const onSubmitPassword = (data: z.infer<typeof schema>) => {
    form.clearErrors("root");
    login.mutate(
      { data },
      {
        onSuccess: onNavigateAfterLogin,
        onError: () => {
          form.setError("root", { message: "Invalid email or password" });
        },
      },
    );
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <img
            src="/chariot-logo.png"
            alt="Chariot Financial Solutions"
            className="mb-4 h-12 object-contain"
          />
          <Tabs
            value={mode}
            onValueChange={(v) =>
              setLocation(v === "staff" ? "/staff/login" : "/login")
            }
            className="mb-2"
          >
            <TabsList>
              <TabsTrigger value="staff">Staff</TabsTrigger>
              <TabsTrigger value="portal">Client portal</TabsTrigger>
            </TabsList>
          </Tabs>
          <CardTitle className="text-2xl">
            {mode === "staff" ? "Staff sign-in" : "Client portal"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmitPassword)}
              className="space-y-4"
            >
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email address</FormLabel>
                    <FormControl>
                      <Input type="email" autoComplete="email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel>Password</FormLabel>
                      <Button
                        type="button"
                        variant="link"
                        className="px-0"
                        size="xs"
                        onClick={() => setLocation("/forgot-password")}
                      >
                        Forgot password?
                      </Button>
                    </div>
                    <InputGroup>
                      <FormControl>
                        <InputGroupInput
                          type={showPassword ? "text" : "password"}
                          autoComplete="current-password"
                          {...field}
                        />
                      </FormControl>
                      <InputGroupAddon align="inline-end">
                        <InputGroupButton
                          size="icon-xs"
                          onClick={() => setShowPassword((visible) => !visible)}
                          aria-label={
                            showPassword ? "Hide password" : "Show password"
                          }
                        >
                          {showPassword ? <EyeOff /> : <Eye />}
                        </InputGroupButton>
                      </InputGroupAddon>
                    </InputGroup>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {form.formState.errors.root && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {form.formState.errors.root.message}
                  </AlertDescription>
                </Alert>
              )}
              <Button
                type="submit"
                className="w-full mt-2"
                disabled={login.isPending}
              >
                {login.isPending ? "Logging in..." : "Log in"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
