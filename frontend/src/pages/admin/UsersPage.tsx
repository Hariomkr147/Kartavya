import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
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
import type { TranslationKey } from "@/i18n";
import type { Role, User } from "@/types/api";
import { RefreshButton } from "@/components/ui/RefreshButton";

type UserSortKey = "name" | "email" | "createdAt";

function memberSince(createdAt: string | undefined, locale: string): string {
  if (!createdAt) return "—";
  return new Date(createdAt).toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
  });
}

const PAGE_SIZE = 15;

const buildCreateUserSchema = (t: TFunction) =>
  z
    .object({
      role: z.enum(["CITIZEN", "OFFICER"]),
      name: z.string().min(1, t("validation.nameRequired")),
      email: z
        .string()
        .min(1, t("validation.emailRequired"))
        .email(t("validation.emailInvalid")),
      password: z.string().min(8, t("validation.passwordMinShort")),
      zoneId: z.string().optional(),
    })
    .refine((v) => v.role !== "OFFICER" || !!v.zoneId, {
      message: t("validation.officerZoneRequired"),
      path: ["zoneId"],
    });
type CreateUserValues = z.infer<ReturnType<typeof buildCreateUserSchema>>;

export function AdminUsersPage() {
  const { t, i18n } = useTranslation();
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
    resolver: zodResolver(useMemo(() => buildCreateUserSchema(t), [t])),
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
      toast({ title: t("adminUsers.created"), variant: "success" });
      setCreateOpen(false);
      reset({ role: "CITIZEN", name: "", email: "", password: "", zoneId: "" });
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "EMAIL_TAKEN") {
        setError("email", { message: error.message });
        return;
      }
      toast({
        title: t("adminUsers.createFailed"),
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
      toast({ title: t("adminUsers.deleted"), variant: "success" });
      setDeletingUser(null);
    } catch (error) {
      setDeleteError(
        error instanceof ApiRequestError
          ? error.message
          : t("errors.generic"),
      );
    }
  }

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-display-sm font-semibold text-ink">
              {t("nav.users")}
            </h1>
            <RefreshButton onRefresh={refetch} refreshing={isFetching} what="users" />
          </div>
          <p className="text-ink-muted mt-1 text-sm">{t("adminUsers.subtitle")}</p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            reset({ role: "CITIZEN", name: "", email: "", password: "", zoneId: "" });
            setCreateOpen(true);
          }}
        >
          <Plus className="size-4" aria-hidden="true" />
          {t("adminUsers.createAccount")}
        </Button>
      </div>

      <div className="flex flex-wrap gap-4 rounded-lg border border-line bg-surface p-4">
        <div className="min-w-[9rem] flex-1">
          <Label htmlFor="role-filter">{t("adminUsers.role")}</Label>
          <Combobox
            id="role-filter"
            value={roleFilter}
            onChange={(v) => {
              setRoleFilter(v as Role | "");
              setPage(1);
            }}
            options={[
              { value: "", label: t("adminUsers.allRoles") },
              { value: "CITIZEN", label: t("roles.citizen") },
              { value: "OFFICER", label: t("roles.officer") },
              { value: "ADMIN", label: t("roles.admin") },
            ]}
          />
        </div>
        <div className="min-w-[9rem] flex-1">
          <Label htmlFor="zone-filter">{t("filters.zone")}</Label>
          <Combobox
            id="zone-filter"
            value={zoneFilter}
            onChange={(v) => {
              setZoneFilter(v);
              setPage(1);
            }}
            options={[
              { value: "", label: t("filters.allZones") },
              ...(zones?.map((z) => ({ value: z.id, label: z.name })) ?? []),
            ]}
          />
        </div>
        <div className="min-w-[9rem] flex-1">
          <Label htmlFor="active-filter">{t("filters.status")}</Label>
          <Combobox
            id="active-filter"
            value={activeFilter}
            onChange={(v) => {
              setActiveFilter(v as "" | "true" | "false");
              setPage(1);
            }}
            options={[
              { value: "", label: t("adminUsers.all") },
              { value: "true", label: t("account.active") },
              { value: "false", label: t("account.deactivated") },
            ]}
          />
        </div>
        <div className="min-w-[12rem] flex-1">
          <Label htmlFor="user-search">{t("adminUsers.searchPage")}</Label>
          <Input
            id="user-search"
            placeholder={t("adminUsers.searchPlaceholder")}
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
          title={t("adminUsers.noMatch")}
          description={t("adminUsers.noMatchBody")}
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
                  {t("adminUsers.name")}
                </SortableHeaderCell>
                <TableHeaderCell>{t("fields.displayName")}</TableHeaderCell>
                <SortableHeaderCell
                  active={sort.key === "email"}
                  direction={sort.direction}
                  onSort={() => toggleSort("email")}
                >
                  {t("fields.email")}
                </SortableHeaderCell>
                <TableHeaderCell>{t("adminUsers.role")}</TableHeaderCell>
                <TableHeaderCell>{t("filters.zone")}</TableHeaderCell>
                <SortableHeaderCell
                  active={sort.key === "createdAt"}
                  direction={sort.direction}
                  onSort={() => toggleSort("createdAt")}
                >
                  {t("adminUsers.memberSince")}
                </SortableHeaderCell>
                <TableHeaderCell>{t("filters.status")}</TableHeaderCell>
                <TableHeaderCell className="text-right">
                  {t("columns.actions")}
                </TableHeaderCell>
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
                    <TableCell className="text-ink-muted text-sm">
                      {t(`roles.${u.role.toLowerCase()}` as TranslationKey)}
                    </TableCell>
                    <TableCell className="text-ink-muted text-sm">
                      {zoneName(u.zoneId)}
                    </TableCell>
                    <TableCell className="text-ink-muted text-sm">
                      {memberSince(u.createdAt, i18n.resolvedLanguage ?? "en")}
                    </TableCell>
                    <TableCell>
                      <span
                        className={
                          u.active
                            ? "bg-status-resolved-subtle text-status-resolved rounded-full px-2.5 py-1 text-xs font-medium"
                            : "bg-status-closed-subtle text-status-closed rounded-full px-2.5 py-1 text-xs font-medium"
                        }
                      >
                        {u.active ? t("account.active") : t("account.deactivated")}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingUser(u)}
                        >
                          {t("common.edit")}
                        </Button>
                        {u.role !== "ADMIN" && (
                          <Dropdown align="end">
                            <DropdownTrigger>
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={t("common.moreActions")}
                              >
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
                                {t("common.delete")}
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
        title={t("adminUsers.createAccount")}
        description={t("adminUsers.createBody")}
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              loading={isSubmitting || createUser.isPending}
              onClick={handleSubmit(onCreateSubmit)}
            >
              {t("common.create")}
            </Button>
          </>
        }
      >
        <form className="space-y-4" noValidate>
          <div>
            <Label htmlFor="create-role" required>
              {t("adminUsers.role")}
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
                    { value: "CITIZEN", label: t("roles.citizen") },
                    { value: "OFFICER", label: t("roles.officer") },
                  ]}
                />
              )}
            />
          </div>
          <div>
            <Label htmlFor="create-name" required>
              {t("fields.fullName")}
            </Label>
            <Input id="create-name" error={errors.name?.message} {...register("name")} />
          </div>
          <div>
            <Label htmlFor="create-email" required>
              {t("fields.email")}
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
              {t("fields.password")}
            </Label>
            <Input
              id="create-password"
              type="password"
              hint={!errors.password ? t("register.passwordHint") : undefined}
              error={errors.password?.message}
              {...register("password")}
            />
          </div>
          <div>
            <Label htmlFor="create-zone" required={watchedRole === "OFFICER"}>
              {t("filters.zone")}
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
                        watchedRole === "OFFICER"
                          ? t("adminUsers.selectZone")
                          : t("adminUsers.noHomeZone"),
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
        title={t("adminUsers.deleteTitle")}
        description={t("adminUsers.deleteBody", { name: deletingUser?.name })}
        footer={
          <>
            <Button variant="outline" onClick={() => setDeletingUser(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              loading={deleteUser.isPending}
              onClick={handleDelete}
            >
              {t("common.delete")}
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
  const { t } = useTranslation();
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
      toast({ title: t("adminUsers.updated"), variant: "success" });
      onSaved();
    } catch (err) {
      if (err instanceof ApiRequestError) setError(err.message);
      else setError(t("errors.generic"));
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("adminUsers.editTitle", { name: user.name })}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button loading={updateUser.isPending} onClick={handleSave}>
            {t("common.saveChanges")}
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
            {t("fields.fullName")}
          </Label>
          <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="edit-email" required>
            {t("fields.email")}
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
              {user.role === "OFFICER"
                ? t("account.assignedZone")
                : t("account.homeZone")}
            </Label>
            <Combobox
              id="edit-zone"
              value={zoneId}
              onChange={setZoneId}
              options={[
                { value: "", label: t("adminUsers.noZone") },
                ...(zones?.map((z) => ({ value: z.id, label: z.name })) ?? []),
              ]}
            />
            {user.role === "OFFICER" && zoneId !== (user.zoneId ?? "") && (
              <p className="text-ink-faint mt-1.5 text-xs">
                {t("adminUsers.reassignNote")}
              </p>
            )}
          </div>
        )}
        <Checkbox
          id="edit-active"
          label={t("adminUsers.accountActive")}
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
      </div>
    </Modal>
  );
}
