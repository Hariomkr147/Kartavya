import { useMemo, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  MoreHorizontal,
  Plus,
  Search,
  ShieldAlert,
  Users as UsersIcon,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Combobox } from "@/components/ui/Combobox";
import { Checkbox } from "@/components/ui/Checkbox";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
} from "@/components/ui/Dropdown";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { useToast } from "@/components/ui/Toast";
import {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  SortableHeaderCell,
  TableCell,
  DataTableEmpty,
} from "@/components/ui/DataTable";
import { useAdminUsers } from "@/hooks/useAdminUsers";
import { useCreateUser } from "@/hooks/useCreateUser";
import { useUpdateUser } from "@/hooks/useUpdateUser";
import { useDeleteUser } from "@/hooks/useDeleteUser";
import { useZones } from "@/hooks/useZones";
import { useSortableRows } from "@/hooks/useSortableRows";
import { ApiRequestError } from "@/services/http";
import type { Role, User } from "@/types/api";
import { RefreshButton } from "@/components/ui/RefreshButton";

type UserSortKey = "name" | "email" | "createdAt";

function memberSince(createdAt?: string): string {
  if (!createdAt) return "—";
  return new Date(createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
  });
}

const PAGE_SIZE = 15;

const createUserSchema = z
  .object({
    role: z.enum(["CITIZEN", "OFFICER"]),
    name: z.string().min(1, "Full name is required"),
    email: z.string().min(1, "Email is required").email("Enter a valid email address"),
    password: z.string().min(8, "At least 8 characters"),
    zoneId: z.string().optional(),
  })
  .refine((v) => v.role !== "OFFICER" || !!v.zoneId, {
    message: "A zone is required for officers",
    path: ["zoneId"],
  });
type CreateUserValues = z.infer<typeof createUserSchema>;

export function AdminUsersPage() {
  const { toast } = useToast();
  const [roleFilter, setRoleFilter] = useState<Role | "">("");
  const [zoneFilter, setZoneFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState<"" | "true" | "false">("");
  const [page, setPage] = useState(1);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [deletingUser, setDeletingUser] = useState<User | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const { data: zones } = useZones();
  const { data, isLoading, isFetching, refetch } = useAdminUsers({
    role: roleFilter || undefined,
    zoneId: zoneFilter || undefined,
    active: activeFilter === "" ? undefined : activeFilter === "true",
    page,
    pageSize: PAGE_SIZE,
  });
  const filteredRows = useMemo(() => {
    const fetched = data?.data ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return fetched;
    return fetched.filter(
      (u) =>
        u.name.toLowerCase().includes(term) ||
        (u.email ?? "").toLowerCase().includes(term),
    );
  }, [data, search]);
  const {
    sorted: rows,
    sort,
    toggleSort,
  } = useSortableRows<User, UserSortKey>(filteredRows, {
    name: (u) => u.name,
    email: (u) => u.email,
    createdAt: (u) => u.createdAt,
  });

  const createUser = useCreateUser();
  const deleteUser = useDeleteUser();

  const {
    register,
    handleSubmit,
    control,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateUserValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { role: "CITIZEN" },
  });
  const watchedRole = useWatch({ control, name: "role" });

  function zoneName(zoneId?: string | null) {
    return zones?.find((z) => z.id === zoneId)?.name ?? "—";
  }

  async function onCreateSubmit(values: CreateUserValues) {
    try {
      await createUser.mutateAsync({
        role: values.role,
        name: values.name,
        email: values.email,
        password: values.password,
        zoneId: values.zoneId || undefined,
      });
      toast({ title: "Account created", variant: "success" });
      setCreateOpen(false);
      reset({ role: "CITIZEN", name: "", email: "", password: "", zoneId: "" });
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "EMAIL_TAKEN") {
        setError("email", { message: error.message });
        return;
      }
      toast({
        title: "Couldn't create account",
        description: error instanceof ApiRequestError ? error.message : undefined,
        variant: "error",
      });
    }
  }

  async function handleDelete() {
    if (!deletingUser) return;
    setDeleteError(null);
    try {
      await deleteUser.mutateAsync(deletingUser.id);
      toast({ title: "Account deleted", variant: "success" });
      setDeletingUser(null);
    } catch (error) {
      setDeleteError(
        error instanceof ApiRequestError
          ? error.message
          : "Something went wrong. Please try again.",
      );
    }
  }

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-display-sm font-semibold text-ink">Users</h1>
            <RefreshButton onRefresh={refetch} refreshing={isFetching} what="users" />
          </div>
          <p className="text-ink-muted mt-1 text-sm">
            Every citizen, officer, and admin account.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            reset({ role: "CITIZEN", name: "", email: "", password: "", zoneId: "" });
            setCreateOpen(true);
          }}
        >
          <Plus className="size-4" aria-hidden="true" />
          Create account
        </Button>
      </div>

      <div className="flex flex-wrap gap-4 rounded-lg border border-line bg-surface p-4">
        <div className="min-w-[9rem] flex-1">
          <Label htmlFor="role-filter">Role</Label>
          <Combobox
            id="role-filter"
            value={roleFilter}
            onChange={(v) => {
              setRoleFilter(v as Role | "");
              setPage(1);
            }}
            options={[
              { value: "", label: "All roles" },
              { value: "CITIZEN", label: "Citizen" },
              { value: "OFFICER", label: "Officer" },
              { value: "ADMIN", label: "Admin" },
            ]}
          />
        </div>
        <div className="min-w-[9rem] flex-1">
          <Label htmlFor="zone-filter">Zone</Label>
          <Combobox
            id="zone-filter"
            value={zoneFilter}
            onChange={(v) => {
              setZoneFilter(v);
              setPage(1);
            }}
            options={[
              { value: "", label: "All zones" },
              ...(zones?.map((z) => ({ value: z.id, label: z.name })) ?? []),
            ]}
          />
        </div>
        <div className="min-w-[9rem] flex-1">
          <Label htmlFor="active-filter">Status</Label>
          <Combobox
            id="active-filter"
            value={activeFilter}
            onChange={(v) => {
              setActiveFilter(v as "" | "true" | "false");
              setPage(1);
            }}
            options={[
              { value: "", label: "All" },
              { value: "true", label: "Active" },
              { value: "false", label: "Deactivated" },
            ]}
          />
        </div>
        <div className="min-w-[12rem] flex-1">
          <Label htmlFor="user-search">Search this page</Label>
          <Input
            id="user-search"
            placeholder="Name or email…"
            value={search}
            leftIcon={<Search className="size-4" aria-hidden="true" />}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title="No accounts match"
          description="Try a different filter or clearing the search box."
          className="rounded-lg border border-line bg-surface"
        />
      ) : (
        <>
          <Table>
            <TableHead>
              <TableRow>
                <SortableHeaderCell
                  active={sort.key === "name"}
                  direction={sort.direction}
                  onSort={() => toggleSort("name")}
                >
                  Name
                </SortableHeaderCell>
                <TableHeaderCell>Display name</TableHeaderCell>
                <SortableHeaderCell
                  active={sort.key === "email"}
                  direction={sort.direction}
                  onSort={() => toggleSort("email")}
                >
                  Email
                </SortableHeaderCell>
                <TableHeaderCell>Role</TableHeaderCell>
                <TableHeaderCell>Zone</TableHeaderCell>
                <SortableHeaderCell
                  active={sort.key === "createdAt"}
                  direction={sort.direction}
                  onSort={() => toggleSort("createdAt")}
                >
                  Member since
                </SortableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell className="text-right">Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 ? (
                <DataTableEmpty colSpan={8}>—</DataTableEmpty>
              ) : (
                rows.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium text-ink">{u.name}</TableCell>
                    <TableCell className="text-ink-muted text-sm">
                      {u.displayName || "—"}
                    </TableCell>
                    <TableCell className="text-ink-muted text-sm">{u.email}</TableCell>
                    <TableCell className="text-ink-muted text-sm">{u.role}</TableCell>
                    <TableCell className="text-ink-muted text-sm">
                      {zoneName(u.zoneId)}
                    </TableCell>
                    <TableCell className="text-ink-muted text-sm">
                      {memberSince(u.createdAt)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={
                          u.active
                            ? "bg-status-resolved-subtle text-status-resolved rounded-full px-2.5 py-1 text-xs font-medium"
                            : "bg-status-closed-subtle text-status-closed rounded-full px-2.5 py-1 text-xs font-medium"
                        }
                      >
                        {u.active ? "Active" : "Deactivated"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingUser(u)}
                        >
                          Edit
                        </Button>
                        {u.role !== "ADMIN" && (
                          <Dropdown align="end">
                            <DropdownTrigger>
                              <Button size="sm" variant="ghost" aria-label="More actions">
                                <MoreHorizontal className="size-4" aria-hidden="true" />
                              </Button>
                            </DropdownTrigger>
                            <DropdownMenu>
                              <DropdownItem
                                destructive
                                onSelect={() => {
                                  setDeletingUser(u);
                                  setDeleteError(null);
                                }}
                              >
                                Delete
                              </DropdownItem>
                            </DropdownMenu>
                          </Dropdown>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {data && (
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={data.pagination.totalItems}
              onPageChange={setPage}
            />
          )}
        </>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create account"
        description="Admins cannot be created here — only citizens and officers."
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={isSubmitting || createUser.isPending}
              onClick={handleSubmit(onCreateSubmit)}
            >
              Create
            </Button>
          </>
        }
      >
        <form className="space-y-4" noValidate>
          <div>
            <Label htmlFor="create-role" required>
              Role
            </Label>
            <Controller
              control={control}
              name="role"
              render={({ field }) => (
                <Combobox
                  id="create-role"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  options={[
                    { value: "CITIZEN", label: "Citizen" },
                    { value: "OFFICER", label: "Officer" },
                  ]}
                />
              )}
            />
          </div>
          <div>
            <Label htmlFor="create-name" required>
              Full name
            </Label>
            <Input id="create-name" error={errors.name?.message} {...register("name")} />
          </div>
          <div>
            <Label htmlFor="create-email" required>
              Email
            </Label>
            <Input
              id="create-email"
              type="email"
              error={errors.email?.message}
              {...register("email")}
            />
          </div>
          <div>
            <Label htmlFor="create-password" required>
              Password
            </Label>
            <Input
              id="create-password"
              type="password"
              hint={!errors.password ? "At least 8 characters." : undefined}
              error={errors.password?.message}
              {...register("password")}
            />
          </div>
          <div>
            <Label htmlFor="create-zone" required={watchedRole === "OFFICER"}>
              Zone
            </Label>
            <Controller
              control={control}
              name="zoneId"
              render={({ field }) => (
                <Combobox
                  id="create-zone"
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  error={errors.zoneId?.message}
                  options={[
                    {
                      value: "",
                      label:
                        watchedRole === "OFFICER" ? "Select a zone…" : "No home zone",
                    },
                    ...(zones?.map((z) => ({ value: z.id, label: z.name })) ?? []),
                  ]}
                />
              )}
            />
          </div>
        </form>
      </Modal>

      {editingUser && (
        <EditUserModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSaved={() => setEditingUser(null)}
        />
      )}

      <Modal
        open={deletingUser !== null}
        onClose={() => setDeletingUser(null)}
        title="Delete account"
        description={`Permanently delete ${deletingUser?.name}? This can't be undone.`}
        footer={
          <>
            <Button variant="outline" onClick={() => setDeletingUser(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={deleteUser.isPending}
              onClick={handleDelete}
            >
              Delete
            </Button>
          </>
        }
      >
        {deleteError && (
          <p
            role="alert"
            className="bg-status-rejected-subtle text-status-rejected flex items-start gap-2 rounded-md px-3 py-2 text-sm"
          >
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {deleteError}
          </p>
        )}
      </Modal>
    </div>
  );
}

function EditUserModal({
  user,
  onClose,
  onSaved,
}: {
  user: User;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const { data: zones } = useZones();
  const updateUser = useUpdateUser(user.id);

  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email ?? "");
  const [zoneId, setZoneId] = useState(user.zoneId ?? "");
  const [active, setActive] = useState(user.active);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    try {
      await updateUser.mutateAsync({
        name: name.trim() || undefined,
        email: email.trim() || undefined,
        zoneId: user.role !== "ADMIN" ? zoneId || undefined : undefined,
        active,
      });
      toast({ title: "Account updated", variant: "success" });
      onSaved();
    } catch (err) {
      if (err instanceof ApiRequestError) setError(err.message);
      else setError("Something went wrong. Please try again.");
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${user.name}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={updateUser.isPending} onClick={handleSave}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <p
            role="alert"
            className="bg-status-rejected-subtle text-status-rejected rounded-md px-3 py-2 text-sm"
          >
            {error}
          </p>
        )}
        <div>
          <Label htmlFor="edit-name" required>
            Full name
          </Label>
          <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="edit-email" required>
            Email
          </Label>
          <Input
            id="edit-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        {user.role !== "ADMIN" && (
          <div>
            <Label htmlFor="edit-zone">
              {user.role === "OFFICER" ? "Assigned zone" : "Home zone"}
            </Label>
            <Combobox
              id="edit-zone"
              value={zoneId}
              onChange={setZoneId}
              options={[
                { value: "", label: "No zone" },
                ...(zones?.map((z) => ({ value: z.id, label: z.name })) ?? []),
              ]}
            />
            {user.role === "OFFICER" && zoneId !== (user.zoneId ?? "") && (
              <p className="text-ink-faint mt-1.5 text-xs">
                Reassigning takes effect immediately — this officer loses access to their
                old zone's complaints, and any still assigned to them there become
                unassigned.
              </p>
            )}
          </div>
        )}
        <Checkbox
          id="edit-active"
          label="Account is active"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
      </div>
    </Modal>
  );
}
