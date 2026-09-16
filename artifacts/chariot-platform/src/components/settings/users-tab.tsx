import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Plus, Send, UserPen, UserX, UserRoundCheck } from "lucide-react";
import {
  useListUsers,
  useCreateUser,
  useUpdateUser,
  useResendUserInvite,
  getListUsersQueryKey,
  getListStaffQueryKey,
  getListStaffProfilesQueryKey,
  type StaffAccount,
  type StaffAccountInviteStatus,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { useAuth } from "@/components/auth-provider";
import { ROLE_LABELS, STAFF_ROLES, type StaffRole } from "@/lib/roles";

const pinSchema = z
  .string()
  .regex(/^[0-9]{4,8}$/, "PIN must be 4 to 8 digits")
  .or(z.literal(""));

const createSchema = z.object({
  displayName: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().email("Valid email required").max(200),
  role: z.enum(STAFF_ROLES),
  pin: pinSchema,
});

const editSchema = z.object({
  displayName: z.string().trim().min(1, "Name is required").max(120),
  role: z.enum(STAFF_ROLES),
  pin: pinSchema,
  clearPin: z.boolean(),
});

const STATUS_BADGE: Record<
  StaffAccount["status"],
  { label: string; variant: "default" | "secondary" | "outline" }
> = {
  active: { label: "Active", variant: "default" },
  invited: { label: "Invited", variant: "secondary" },
  deactivated: { label: "Deactivated", variant: "outline" },
};

/** Explains what happened to the setup email after create/resend. */
function inviteToast(user: StaffAccount, status: StaffAccountInviteStatus) {
  switch (status) {
    case "sent":
      return toast.add({
        title: `Setup link sent to ${user.email}`,
        description: "They have 7 days to choose a password.",
        type: "success",
      });
    case "disabled":
      return toast.add({
        title: `${user.displayName} added, but no email was sent`,
        description:
          "Email delivery is switched off in this environment. Use Resend setup link once it is on.",
        type: "warning",
      });
    case "failed":
      return toast.add({
        title: `${user.displayName} added, but the setup email failed`,
        description: "Check the server log and use Resend setup link.",
        type: "error",
      });
    default:
      return;
  }
}

function useInvalidateUsers() {
  const qc = useQueryClient();
  // Write the saved row into the list straight away so the table reflects the
  // change before the refetch lands, then refresh everything that lists staff
  // (assignee pickers and the PIN-login profile grid included).
  return (saved?: StaffAccount) => {
    if (saved) {
      qc.setQueryData(
        getListUsersQueryKey(),
        (existing: StaffAccount[] | undefined) =>
          existing?.some((user) => user.id === saved.id)
            ? existing.map((user) => (user.id === saved.id ? saved : user))
            : [...(existing ?? []), saved],
      );
    }
    qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
    qc.invalidateQueries({ queryKey: getListStaffQueryKey() });
    qc.invalidateQueries({ queryKey: getListStaffProfilesQueryKey() });
  };
}

function RoleSelectItems() {
  return (
    <>
      {STAFF_ROLES.map((role) => (
        <SelectItem key={role} value={role}>
          {ROLE_LABELS[role]}
        </SelectItem>
      ))}
    </>
  );
}

function AddUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createUser = useCreateUser();
  const invalidate = useInvalidateUsers();
  const form = useForm<z.infer<typeof createSchema>>({
    resolver: zodResolver(createSchema),
    defaultValues: { displayName: "", email: "", role: "case_manager", pin: "" },
  });

  useEffect(() => {
    if (open) form.reset();
  }, [open, form]);

  const onSubmit = (data: z.infer<typeof createSchema>) => {
    createUser.mutate(
      {
        data: {
          displayName: data.displayName,
          email: data.email,
          role: data.role,
          pin: data.pin || null,
        },
      },
      {
        onSuccess: (user) => {
          invalidate(user);
          inviteToast(user, user.inviteStatus);
          onOpenChange(false);
        },
        onError: (error) =>
          toast.add({
            title: "Could not add user",
            description:
              error.status === 409
                ? "An account with that email already exists."
                : error.message,
            type: "error",
          }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
          <DialogDescription>
            They will receive an email with a link to choose their password.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4"
            noValidate
          >
            <FormField
              control={form.control}
              name="displayName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input autoFocus placeholder="Jane Smith" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      autoComplete="off"
                      placeholder="jane@example.com"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <RoleSelectItems />
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="pin"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>PIN (optional)</FormLabel>
                  <FormControl>
                    <Input
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={8}
                      placeholder="4–8 digits"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Lets them sign in from the staff profile picker without a
                    password.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createUser.isPending}>
                {createUser.isPending ? "Adding…" : "Add user"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({
  user,
  isSelf,
  onOpenChange,
}: {
  user: StaffAccount | null;
  isSelf: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const updateUser = useUpdateUser();
  const invalidate = useInvalidateUsers();
  const form = useForm<z.infer<typeof editSchema>>({
    resolver: zodResolver(editSchema),
    defaultValues: { displayName: "", role: "case_manager", pin: "", clearPin: false },
  });

  useEffect(() => {
    if (user) {
      form.reset({
        displayName: user.displayName,
        role: user.role,
        pin: "",
        clearPin: false,
      });
    }
  }, [user, form]);

  const clearPin = form.watch("clearPin");

  const onSubmit = (data: z.infer<typeof editSchema>) => {
    if (!user) return;
    updateUser.mutate(
      {
        id: user.id,
        data: {
          displayName: data.displayName,
          role: data.role,
          // Omit pin entirely unless the admin typed one or asked to remove it.
          ...(data.clearPin ? { pin: null } : data.pin ? { pin: data.pin } : {}),
        },
      },
      {
        onSuccess: (saved) => {
          invalidate(saved);
          toast.add({ title: "User updated", type: "success" });
          onOpenChange(false);
        },
        onError: (error) =>
          toast.add({
            title: "Could not update user",
            description: error.message,
            type: "error",
          }),
      },
    );
  };

  return (
    <Dialog open={user != null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit user</DialogTitle>
          <DialogDescription>{user?.email}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4"
            noValidate
          >
            <FormField
              control={form.control}
              name="displayName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={isSelf}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <RoleSelectItems />
                    </SelectContent>
                  </Select>
                  {isSelf && (
                    <FormDescription>
                      You cannot change your own role.
                    </FormDescription>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="pin"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>PIN</FormLabel>
                  <FormControl>
                    <Input
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={8}
                      disabled={clearPin}
                      placeholder={
                        user?.hasPin ? "Leave blank to keep current PIN" : "4–8 digits"
                      }
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {user?.hasPin && (
              <FormField
                control={form.control}
                name="clearPin"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(checked) =>
                          field.onChange(checked === true)
                        }
                      />
                    </FormControl>
                    <FormLabel className="font-normal">
                      Remove PIN sign-in for this account
                    </FormLabel>
                  </FormItem>
                )}
              />
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={updateUser.isPending}>
                {updateUser.isPending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function UsersTab({ isAdmin }: { isAdmin: boolean }) {
  const { user: me } = useAuth();
  const { data: users, isLoading, error } = useListUsers({
    query: { enabled: isAdmin, queryKey: getListUsersQueryKey() },
  });
  const updateUser = useUpdateUser();
  const resendInvite = useResendUserInvite();
  const invalidate = useInvalidateUsers();

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<StaffAccount | null>(null);
  const [deactivating, setDeactivating] = useState<StaffAccount | null>(null);

  const setActive = (user: StaffAccount, active: boolean) =>
    updateUser.mutate(
      { id: user.id, data: { active } },
      {
        onSuccess: (saved) => {
          invalidate(saved);
          toast.add({
            title: active
              ? `${user.displayName} reactivated`
              : `${user.displayName} deactivated`,
            type: "success",
          });
        },
        onError: (err) =>
          toast.add({
            title: active ? "Could not reactivate" : "Could not deactivate",
            description: err.message,
            type: "error",
          }),
      },
    );

  const resend = (user: StaffAccount) =>
    resendInvite.mutate(
      { id: user.id },
      {
        onSuccess: (saved) => inviteToast(saved, saved.inviteStatus),
        onError: (err) =>
          toast.add({
            title: "Could not send setup link",
            description: err.message,
            type: "error",
          }),
      },
    );

  if (!isAdmin) {
    return (
      <TabsContent value="users">
        <p className="text-xs text-muted-foreground italic">
          Only administrators can manage users.
        </p>
      </TabsContent>
    );
  }

  return (
    <TabsContent value="users" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Staff who can sign in to Chariot. New users get an email link to
          choose their password; deactivated users are signed out and can no
          longer log in, but stay on past records.
        </p>
        <Button onClick={() => setAdding(true)} className="shrink-0">
          <Plus />
          Add user
        </Button>
      </div>

      <Card className="gap-0 overflow-hidden py-0">
        {isLoading ? (
          <div className="p-5 space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : error ? (
          <p className="p-5 text-sm text-destructive">
            Could not load users: {error.message}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>PIN</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users?.map((user) => {
                const isSelf = user.id === me?.id;
                const badge = STATUS_BADGE[user.status];
                return (
                  <TableRow
                    key={user.id}
                    className={user.active ? undefined : "text-muted-foreground"}
                  >
                    <TableCell className="font-medium">
                      {user.displayName}
                      {isSelf && (
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          (you)
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {user.email}
                    </TableCell>
                    <TableCell>{ROLE_LABELS[user.role as StaffRole]}</TableCell>
                    <TableCell>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {user.hasPin ? "Set" : "—"}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label={`Actions for ${user.displayName}`}
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setEditing(user)}>
                            <UserPen />
                            Edit
                          </DropdownMenuItem>
                          {user.active && (
                            <DropdownMenuItem onSelect={() => resend(user)}>
                              <Send />
                              {user.status === "invited"
                                ? "Resend setup link"
                                : "Send password setup link"}
                            </DropdownMenuItem>
                          )}
                          {!isSelf && (
                            <>
                              <DropdownMenuSeparator />
                              {user.active ? (
                                <DropdownMenuItem
                                  variant="destructive"
                                  onSelect={() => setDeactivating(user)}
                                >
                                  <UserX />
                                  Deactivate
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem
                                  onSelect={() => setActive(user, true)}
                                >
                                  <UserRoundCheck />
                                  Reactivate
                                </DropdownMenuItem>
                              )}
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
              {users?.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-sm text-muted-foreground py-8"
                  >
                    No users yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </Card>

      <AddUserDialog open={adding} onOpenChange={setAdding} />
      <EditUserDialog
        user={editing}
        isSelf={editing?.id === me?.id}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
      <ConfirmDialog
        open={deactivating != null}
        onOpenChange={(open) => {
          if (!open) setDeactivating(null);
        }}
        title={`Deactivate ${deactivating?.displayName}?`}
        description="They will be signed out immediately and unable to log in. Their name stays on existing cases, tasks and messages. You can reactivate them later."
        actionLabel="Deactivate"
        destructive
        onConfirm={() => {
          if (deactivating) setActive(deactivating, false);
          setDeactivating(null);
        }}
      />
    </TabsContent>
  );
}
