import { Fragment, useMemo, useState } from "react";
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
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from "@/components/ui/Dropdown";
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

export function AdminZonesPage() {
  const [tab, setTab] = useState("zones");

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-display-sm font-semibold text-ink">
            Zones &amp; SLAs
          </h1>
          <p className="text-ink-muted mt-1 text-sm">
            Manage zones, category SLA targets, and per-zone AI health reports.
          </p>
        </div>
        <Link
          to="/admin/settings"
          className="text-ink-muted hover:text-ink inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
        >
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          System settings
        </Link>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="zones">Zones</TabsTrigger>
          <TabsTrigger value="slas">SLAs</TabsTrigger>
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
      if (z.zoneId) map.set(z.zoneId, { pending: z.pending ?? 0, overdue: z.overdue ?? 0 });
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
      toast({ title: "Zone deleted", variant: "success" });
      setDeletingZone(null);
    } catch (error) {
      setDeleteError(
        error instanceof ApiRequestError
          ? error.message
          : "Something went wrong. Please try again.",
      );
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-[14rem] flex-1 sm:max-w-xs">
          <Label htmlFor="zone-search">Search zones</Label>
          <Input
            id="zone-search"
            placeholder="Code or name…"
            value={search}
            leftIcon={<Search className="size-4" aria-hidden="true" />}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" aria-hidden="true" />
          Create zone
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : visibleZones.length === 0 ? (
        <p className="text-ink-muted text-sm">No zones match &ldquo;{search}&rdquo;.</p>
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell className="w-8" />
              <TableHeaderCell>Code</TableHeaderCell>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Pending</TableHeaderCell>
              <TableHeaderCell>Overdue</TableHeaderCell>
              <TableHeaderCell className="text-right">Actions</TableHeaderCell>
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
                        aria-label={expanded ? "Collapse zone detail" : "Expand zone detail"}
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
                          Catch-all
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
                        {zone.isActive ? "Active" : "Deactivated"}
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
                          Assign officer
                        </Button>
                        <Dropdown align="end">
                          <DropdownTrigger>
                            <Button size="sm" variant="ghost" aria-label="More actions">
                              <MoreHorizontal className="size-4" aria-hidden="true" />
                            </Button>
                          </DropdownTrigger>
                          <DropdownMenu>
                            <DropdownItem onSelect={() => setEditingZone(zone)}>
                              Edit
                            </DropdownItem>
                            {!zone.isCatchAll && (
                              <DropdownItem
                                destructive
                                onSelect={() => {
                                  setDeletingZone(zone);
                                  setDeleteError(null);
                                }}
                              >
                                Delete
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
        title="Delete zone"
        description={`Permanently delete ${deletingZone?.name}? This only works if nothing references it.`}
        footer={
          <>
            <Button variant="outline" onClick={() => setDeletingZone(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={deleteZone.isPending}
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

function CreateZoneModal({ open, onClose }: { open: boolean; onClose: () => void }) {
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
      setError("Code, name, and a centre point are all required.");
      return;
    }
    try {
      await createZone.mutateAsync({
        code: code.trim(),
        name: name.trim(),
        centerLat: center.lat,
        centerLng: center.lng,
      });
      toast({ title: "Zone created", variant: "success" });
      resetAndClose();
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : "Something went wrong. Please try again.",
      );
    }
  }

  return (
    <Modal
      open={open}
      onClose={resetAndClose}
      title="Create zone"
      description="Click the map to set the zone's centre point — routing uses nearest-centroid, so every location maps to exactly one zone."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={resetAndClose}>
            Cancel
          </Button>
          <Button loading={createZone.isPending} onClick={handleCreate}>
            Create zone
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
              Code
            </Label>
            <Input
              id="zone-code"
              placeholder="WARD-12-N"
              hint="Permanent once created."
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="zone-name" required>
              Name
            </Label>
            <Input
              id="zone-name"
              placeholder="Ward 12 – North"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </div>
        <div>
          <Label required>Centre point</Label>
          <MapPicker
            value={center}
            onChange={setCenter}
            height={280}
            searchPlaceholder="Search a ward or landmark, or paste coordinates…"
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
  const { toast } = useToast();
  const updateZone = useUpdateZone(zone.id);
  const [name, setName] = useState(zone.name);
  const [isActive, setIsActive] = useState(zone.isActive);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    try {
      await updateZone.mutateAsync({ name: name.trim() || undefined, isActive });
      toast({ title: "Zone updated", variant: "success" });
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : "Something went wrong. Please try again.",
      );
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${zone.name}`}
      description="The zone code can't be changed here."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={updateZone.isPending} onClick={handleSave}>
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
          <Label htmlFor="edit-zone-name" required>
            Name
          </Label>
          <Input
            id="edit-zone-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <Checkbox
          id="edit-zone-active"
          label="Zone is active (accepts new complaints)"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
        />
      </div>
    </Modal>
  );
}

function AssignOfficerModal({ zone, onClose }: { zone: Zone; onClose: () => void }) {
  const { toast } = useToast();
  const { data: officers, isLoading } = useAdminUsers({ role: "OFFICER", pageSize: 100 });
  const assignOfficer = useAssignOfficerToZone(zone.id);
  const [officerId, setOfficerId] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleAssign() {
    setError(null);
    if (!officerId) {
      setError("Choose an officer.");
      return;
    }
    try {
      await assignOfficer.mutateAsync(officerId);
      toast({ title: "Officer assigned", variant: "success" });
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : "Something went wrong. Please try again.",
      );
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Assign officer to ${zone.name}`}
      description="Takes effect immediately — the officer's non-terminal complaints in their old zone become unassigned."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={assignOfficer.isPending} onClick={handleAssign}>
            Assign
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
            Officer
          </Label>
          {isLoading ? (
            <Skeleton className="h-11 w-full" />
          ) : (
            <Combobox
              id="assign-officer"
              value={officerId}
              onChange={setOfficerId}
              options={[
                { value: "", label: "Select an officer…" },
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
  const { data: categories, isLoading } = useCategories();

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-3">
      <p className="text-ink-muted -mt-1 text-sm">
        Applies to complaints accepted after the change — work already in progress keeps
        its original target.
      </p>
      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell>Category</TableHeaderCell>
            <TableHeaderCell>Target (hours)</TableHeaderCell>
            <TableHeaderCell className="text-right">Actions</TableHeaderCell>
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
  const { toast } = useToast();
  const updateSla = useUpdateSla(categoryId);
  const [value, setValue] = useState(String(targetHours));
  const [error, setError] = useState<string | null>(null);
  const dirty = Number(value) !== targetHours;

  async function handleSave() {
    setError(null);
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
      setError("Must be a whole number ≥ 1.");
      return;
    }
    try {
      await updateSla.mutateAsync(parsed);
      toast({ title: `${name} SLA updated`, variant: "success" });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't update.");
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
          Save
        </Button>
      </TableCell>
    </TableRow>
  );
}
