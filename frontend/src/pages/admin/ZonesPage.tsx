import { Fragment, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Plus,
  Search,
  ShieldAlert,
  SlidersHorizontal,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Combobox } from "@/components/ui/Combobox";
import { Checkbox } from "@/components/ui/Checkbox";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { MapPicker, type LatLng } from "@/components/ui/MapPicker";
import { useToast } from "@/components/ui/Toast";
import {
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
} from "@/components/ui/Dropdown";
import {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
} from "@/components/ui/DataTable";
import { ZoneSummaryPanel } from "@/components/admin/ZoneSummaryPanel";
import { ZoneAiReportPanel } from "@/components/admin/ZoneAiReportPanel";
import { useZones } from "@/hooks/useZones";
import { useCategories } from "@/hooks/useCategories";
import { useAdminUsers } from "@/hooks/useAdminUsers";
import { useAdminAnalytics } from "@/hooks/useAdminAnalytics";
import { useCreateZone } from "@/hooks/useCreateZone";
import { useUpdateZone } from "@/hooks/useUpdateZone";
import { useDeleteZone } from "@/hooks/useDeleteZone";
import { useAssignOfficerToZone } from "@/hooks/useAssignOfficerToZone";
import { useUpdateSla } from "@/hooks/useUpdateSla";
import { ApiRequestError } from "@/services/http";
import type { Zone } from "@/types/api";
import { RefreshButton } from "@/components/ui/RefreshButton";

export function AdminZonesPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState("zones");
  // Same query key as ZonesTab's own `useZones`, so this shares the cache
  // and refetching here updates the table below.
  const { isFetching, refetch } = useZones();

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-display-sm font-semibold text-ink">
              {t("nav.zonesAndSlas")}
            </h1>
            <RefreshButton onRefresh={refetch} refreshing={isFetching} what="zones" />
          </div>
          <p className="text-ink-muted mt-1 text-sm">{t("adminZones.subtitle")}</p>
        </div>
        <Link
          to="/admin/settings"
          className="text-ink-muted hover:text-ink inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
        >
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          {t("adminZones.systemSettings")}
        </Link>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="zones">{t("adminDashboard.zones")}</TabsTrigger>
          <TabsTrigger value="slas">{t("adminZones.slas")}</TabsTrigger>
        </TabsList>
        <TabsContent value="zones" className="mt-6">
          <ZonesTab />
        </TabsContent>
        <TabsContent value="slas" className="mt-6">
          <SlasTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ZonesTab() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data: zones, isLoading } = useZones();
  const { data: analytics } = useAdminAnalytics();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingZone, setEditingZone] = useState<Zone | null>(null);
  const [assigningZone, setAssigningZone] = useState<Zone | null>(null);
  const [deletingZone, setDeletingZone] = useState<Zone | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expandedZoneId, setExpandedZoneId] = useState<string | null>(null);
  const deleteZone = useDeleteZone();

  const metricsByZone = useMemo(() => {
    const map = new Map<string, { pending: number; overdue: number }>();
    for (const z of analytics?.zones ?? []) {
      if (z.zoneId)
        map.set(z.zoneId, { pending: z.pending ?? 0, overdue: z.overdue ?? 0 });
    }
    return map;
  }, [analytics]);

  const visibleZones = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return zones ?? [];
    return (zones ?? []).filter(
      (z) => z.code.toLowerCase().includes(term) || z.name.toLowerCase().includes(term),
    );
  }, [zones, search]);

  async function handleDelete() {
    if (!deletingZone) return;
    setDeleteError(null);
    try {
      await deleteZone.mutateAsync(deletingZone.id);
      toast({ title: t("adminZones.deleted"), variant: "success" });
      setDeletingZone(null);
    } catch (error) {
      setDeleteError(
        error instanceof ApiRequestError ? error.message : t("errors.generic"),
      );
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-[14rem] flex-1 sm:max-w-xs">
          <Label htmlFor="zone-search">{t("adminZones.searchZones")}</Label>
          <Input
            id="zone-search"
            placeholder={t("adminZones.searchPlaceholder")}
            value={search}
            leftIcon={<Search className="size-4" aria-hidden="true" />}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" aria-hidden="true" />
          {t("adminZones.createZone")}
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : visibleZones.length === 0 ? (
        <p className="text-ink-muted text-sm">
          {t("adminZones.noMatch", { search })}
        </p>
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell className="w-8" />
              <TableHeaderCell>{t("adminZones.code")}</TableHeaderCell>
              <TableHeaderCell>{t("adminUsers.name")}</TableHeaderCell>
              <TableHeaderCell>{t("filters.status")}</TableHeaderCell>
              <TableHeaderCell>{t("adminDashboard.pending")}</TableHeaderCell>
              <TableHeaderCell>{t("sla.OVERDUE")}</TableHeaderCell>
              <TableHeaderCell className="text-right">
                {t("columns.actions")}
              </TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {visibleZones.map((zone) => {
              const metrics = metricsByZone.get(zone.id);
              const expanded = expandedZoneId === zone.id;
              return (
                <Fragment key={zone.id}>
                  <TableRow>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => setExpandedZoneId(expanded ? null : zone.id)}
                        aria-expanded={expanded}
                        aria-label={
                          expanded
                            ? t("adminDashboard.collapseZone")
                            : t("adminDashboard.expandZone")
                        }
                        className="text-ink-muted hover:text-ink flex size-6 items-center justify-center rounded"
                      >
                        {expanded ? (
                          <ChevronDown className="size-4" aria-hidden="true" />
                        ) : (
                          <ChevronRight className="size-4" aria-hidden="true" />
                        )}
                      </button>
                    </TableCell>
                    <TableCell className="text-ink-muted font-mono text-xs">
                      {zone.code}
                    </TableCell>
                    <TableCell className="font-medium text-ink">
                      {zone.name}
                      {zone.isCatchAll && (
                        <span className="bg-surface-hover text-ink-muted ml-2 rounded-full px-2 py-0.5 text-xs">
                          {t("adminZones.catchAll")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className={
                          zone.isActive
                            ? "bg-status-resolved-subtle text-status-resolved rounded-full px-2.5 py-1 text-xs font-medium"
                            : "bg-status-closed-subtle text-status-closed rounded-full px-2.5 py-1 text-xs font-medium"
                        }
                      >
                        {zone.isActive ? t("account.active") : t("account.deactivated")}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Link
                        to={`/admin/complaints?zone=${zone.id}`}
                        className="hover:underline"
                      >
                        {metrics?.pending ?? "—"}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link
                        to={`/admin/complaints?zone=${zone.id}&sla=OVERDUE`}
                        className={
                          metrics?.overdue
                            ? "text-sla-overdue font-semibold hover:underline"
                            : "hover:underline"
                        }
                      >
                        {metrics?.overdue ?? "—"}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setAssigningZone(zone)}
                        >
                          {t("adminZones.assignOfficer")}
                        </Button>
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
                            <DropdownItem onSelect={() => setEditingZone(zone)}>
                              {t("common.edit")}
                            </DropdownItem>
                            {!zone.isCatchAll && (
                              <DropdownItem
                                destructive
                                onSelect={() => {
                                  setDeletingZone(zone);
                                  setDeleteError(null);
                                }}
                              >
                                {t("common.delete")}
                              </DropdownItem>
                            )}
                          </DropdownMenu>
                        </Dropdown>
                      </div>
                    </TableCell>
                  </TableRow>
                  {expanded && (
                    <TableRow>
                      <TableCell colSpan={7} className="bg-canvas space-y-3 p-4">
                        <ZoneSummaryPanel zoneId={zone.id} />
                        <ZoneAiReportPanel zoneId={zone.id} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      )}

      <CreateZoneModal open={createOpen} onClose={() => setCreateOpen(false)} />
      {editingZone && (
        <EditZoneModal zone={editingZone} onClose={() => setEditingZone(null)} />
      )}
      {assigningZone && (
        <AssignOfficerModal zone={assigningZone} onClose={() => setAssigningZone(null)} />
      )}

      <Modal
        open={deletingZone !== null}
        onClose={() => setDeletingZone(null)}
        title={t("adminZones.deleteTitle")}
        description={t("adminZones.deleteBody", { name: deletingZone?.name })}
        footer={
          <>
            <Button variant="outline" onClick={() => setDeletingZone(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              loading={deleteZone.isPending}
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

function CreateZoneModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const createZone = useCreateZone();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [center, setCenter] = useState<LatLng | null>(null);
  const [error, setError] = useState<string | null>(null);

  function resetAndClose() {
    setCode("");
    setName("");
    setCenter(null);
    setError(null);
    onClose();
  }

  async function handleCreate() {
    setError(null);
    if (!code.trim() || !name.trim() || !center) {
      setError(t("adminZones.createRequired"));
      return;
    }
    try {
      await createZone.mutateAsync({
        code: code.trim(),
        name: name.trim(),
        centerLat: center.lat,
        centerLng: center.lng,
      });
      toast({ title: t("adminZones.created"), variant: "success" });
      resetAndClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("errors.generic"));
    }
  }

  return (
    <Modal
      open={open}
      onClose={resetAndClose}
      title={t("adminZones.createZone")}
      description={t("adminZones.createBody")}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={resetAndClose}>
            {t("common.cancel")}
          </Button>
          <Button loading={createZone.isPending} onClick={handleCreate}>
            {t("adminZones.createZone")}
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
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="zone-code" required>
              {t("adminZones.code")}
            </Label>
            <Input
              id="zone-code"
              placeholder="WARD-12-N"
              hint={t("adminZones.codeHint")}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="zone-name" required>
              {t("adminUsers.name")}
            </Label>
            <Input
              id="zone-name"
              placeholder={t("adminZones.namePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </div>
        <div>
          <Label required>{t("adminZones.centrePoint")}</Label>
          <MapPicker
            value={center}
            onChange={setCenter}
            height={280}
            searchPlaceholder="Search a ward, or paste coordinates or a plus code…"
          />
          {center && (
            <p className="text-ink-faint mt-1.5 text-xs">
              {center.lat.toFixed(5)}, {center.lng.toFixed(5)}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}

function EditZoneModal({ zone, onClose }: { zone: Zone; onClose: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const updateZone = useUpdateZone(zone.id);
  const [name, setName] = useState(zone.name);
  const [isActive, setIsActive] = useState(zone.isActive);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    try {
      await updateZone.mutateAsync({ name: name.trim() || undefined, isActive });
      toast({ title: t("adminZones.updated"), variant: "success" });
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("errors.generic"));
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("adminUsers.editTitle", { name: zone.name })}
      description={t("adminZones.editBody")}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button loading={updateZone.isPending} onClick={handleSave}>
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
          <Label htmlFor="edit-zone-name" required>
            {t("adminUsers.name")}
          </Label>
          <Input
            id="edit-zone-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <Checkbox
          id="edit-zone-active"
          label={t("adminZones.zoneActive")}
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
        />
      </div>
    </Modal>
  );
}

function AssignOfficerModal({ zone, onClose }: { zone: Zone; onClose: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data: officers, isLoading } = useAdminUsers({ role: "OFFICER", pageSize: 100 });
  const assignOfficer = useAssignOfficerToZone(zone.id);
  const [officerId, setOfficerId] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleAssign() {
    setError(null);
    if (!officerId) {
      setError(t("adminZones.chooseOfficer"));
      return;
    }
    try {
      await assignOfficer.mutateAsync(officerId);
      toast({ title: t("adminZones.officerAssigned"), variant: "success" });
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("errors.generic"));
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("adminZones.assignTitle", { zone: zone.name })}
      description={t("adminZones.assignBody")}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button loading={assignOfficer.isPending} onClick={handleAssign}>
            {t("adminZones.assign")}
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
          <Label htmlFor="assign-officer" required>
            {t("roles.officer")}
          </Label>
          {isLoading ? (
            <Skeleton className="h-11 w-full" />
          ) : (
            <Combobox
              id="assign-officer"
              value={officerId}
              onChange={setOfficerId}
              options={[
                { value: "", label: t("adminZones.selectOfficer") },
                ...(officers?.data.map((o) => ({
                  value: o.id,
                  label: `${o.name} (${o.email})`,
                })) ?? []),
              ]}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}

function SlasTab() {
  const { t } = useTranslation();
  const { data: categories, isLoading } = useCategories();

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-3">
      <p className="text-ink-muted -mt-1 text-sm">
        {t("adminZones.slaNote")}
      </p>
      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell>{t("filters.category")}</TableHeaderCell>
            <TableHeaderCell>{t("adminZones.targetHours")}</TableHeaderCell>
            <TableHeaderCell className="text-right">
              {t("columns.actions")}
            </TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {categories?.map((category) => (
            <SlaRow
              key={category.id}
              categoryId={category.id}
              name={category.name}
              targetHours={category.slaTargetHours}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SlaRow({
  categoryId,
  name,
  targetHours,
}: {
  categoryId: string;
  name: string;
  targetHours: number;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const updateSla = useUpdateSla(categoryId);
  const [value, setValue] = useState(String(targetHours));
  const [error, setError] = useState<string | null>(null);
  const dirty = Number(value) !== targetHours;

  async function handleSave() {
    setError(null);
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
      setError(t("adminSettings.wholeNumber"));
      return;
    }
    try {
      await updateSla.mutateAsync(parsed);
      toast({ title: t("adminZones.slaUpdated", { name }), variant: "success" });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("adminSettings.updateFailed"));
    }
  }

  return (
    <TableRow>
      <TableCell className="font-medium text-ink">{name}</TableCell>
      <TableCell>
        <Input
          className="w-28"
          type="number"
          min={1}
          value={value}
          error={error ?? undefined}
          onChange={(e) => setValue(e.target.value)}
        />
      </TableCell>
      <TableCell className="text-right">
        <Button
          size="sm"
          variant="outline"
          disabled={!dirty}
          loading={updateSla.isPending}
          onClick={handleSave}
        >
          {t("common.save")}
        </Button>
      </TableCell>
    </TableRow>
  );
}
