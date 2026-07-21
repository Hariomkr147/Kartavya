import { useState } from "react";
import { Search, Mail, Plus, MoreVertical, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { Checkbox } from "@/components/ui/Checkbox";
import { Label } from "@/components/ui/Label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/Card";
import { StatusPill, SeverityPill, SlaPill } from "@/components/ui/pills";
import { Modal } from "@/components/ui/Modal";
import {
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
} from "@/components/ui/Dropdown";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";
import { Tooltip } from "@/components/ui/Tooltip";
import { useToast } from "@/components/ui/Toast";
import { Pagination } from "@/components/ui/Pagination";
import {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
} from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { FileDropzone } from "@/components/ui/FileDropzone";
import { MapPicker, type LatLng } from "@/components/ui/MapPicker";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import type { ComplaintStatus, SeverityLabel, SlaLabel } from "@/types/api";

const STATUSES: ComplaintStatus[] = [
  "SUBMITTED",
  "EVIDENCE_UNDER_REVIEW",
  "NEEDS_MORE_EVIDENCE",
  "REJECTED",
  "UNDER_REVIEW",
  "IN_PROGRESS",
  "UNDER_RESOLUTION",
  "RESOLVED",
  "CLOSED",
  "REOPENED",
  "UNRESOLVABLE",
];
const SEVERITIES: SeverityLabel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const SLAS: SlaLabel[] = ["ON_TIME", "DELAYED", "OVERDUE"];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="font-display text-2xl font-semibold text-ink">{title}</h2>
      <div className="rounded-lg border border-line bg-surface p-6">{children}</div>
    </section>
  );
}

export function ComponentPlayground() {
  const [modalOpen, setModalOpen] = useState(false);
  const [tab, setTab] = useState("all");
  const [page, setPage] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [point, setPoint] = useState<LatLng | null>({ lat: 12.9716, lng: 77.5946 });
  const { toast } = useToast();

  return (
    <div className="min-h-screen bg-canvas pb-24 text-ink">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface px-8 py-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-ink">
            Kartavya component playground
          </h1>
          <p className="text-ink-muted text-sm">
            Stage 4 — bespoke UI primitives, removed once real screens exist.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <main className="mx-auto max-w-5xl space-y-12 px-8 py-10">
        <Section title="Typography">
          <div className="space-y-2">
            <p className="text-display-xl font-display font-semibold">Display XL</p>
            <p className="text-display-lg font-display font-semibold">Display LG</p>
            <p className="text-display-md font-display font-semibold">Display MD</p>
            <p className="text-display-sm font-display font-semibold">Display SM</p>
            <p className="font-mono text-sm text-ink-muted">
              KRT-2026-000104 · IBM Plex Mono for data/codes
            </p>
          </div>
        </Section>

        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="primary" loading>
              Loading
            </Button>
            <Button variant="primary" disabled>
              Disabled
            </Button>
            <Button variant="primary" leftIcon={<Plus className="size-4" />}>
              With icon
            </Button>
            <Button variant="outline" size="icon" aria-label="More options">
              <MoreVertical className="size-4" />
            </Button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg">Large</Button>
          </div>
        </Section>

        <Section title="Form fields">
          <div className="grid max-w-xl gap-4">
            <div>
              <Label htmlFor="pg-email" required>
                Email
              </Label>
              <Input
                id="pg-email"
                type="email"
                placeholder="you@example.com"
                leftIcon={<Mail className="size-4" />}
              />
            </div>
            <div>
              <Label htmlFor="pg-search">Search</Label>
              <Input
                id="pg-search"
                placeholder="Search complaints…"
                leftIcon={<Search className="size-4" />}
              />
            </div>
            <div>
              <Label htmlFor="pg-error" required>
                With error
              </Label>
              <Input
                id="pg-error"
                defaultValue="not-an-email"
                error="Enter a valid email address."
              />
            </div>
            <div>
              <Label htmlFor="pg-desc">Description</Label>
              <Textarea
                id="pg-desc"
                placeholder="Describe the issue…"
                hint="Be specific — location, size, how long it's been there."
              />
            </div>
            <div>
              <Label htmlFor="pg-zone">Zone</Label>
              <Select id="pg-zone" defaultValue="">
                <option value="" disabled>
                  Choose a zone…
                </option>
                <option value="zone2">Ward 12 — North</option>
                <option value="zone3">Ward 7 — South</option>
                <option value="zone4">Ward 14 — Central</option>
              </Select>
            </div>
            <Checkbox
              id="pg-check"
              label="Notify me by email when the status changes"
              defaultChecked
            />
          </div>
        </Section>

        <Section title="Status, severity & SLA pills">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((s) => (
                <StatusPill key={s} status={s} />
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {SEVERITIES.map((s) => (
                <SeverityPill key={s} severity={s} />
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {SLAS.map((s) => (
                <SlaPill key={s} sla={s} />
              ))}
            </div>
          </div>
        </Section>

        <Section title="Card">
          <Card className="max-w-md">
            <CardHeader>
              <div>
                <CardTitle>Pothole on 5th Cross</CardTitle>
                <CardDescription>Ward 12 — North · Roads &amp; Potholes</CardDescription>
              </div>
              <StatusPill status="IN_PROGRESS" />
            </CardHeader>
            <CardContent>
              <p className="text-sm text-ink-muted">
                3 reports clustered · severity computed from unique reporters + upvotes.
              </p>
            </CardContent>
            <CardFooter>
              <Button size="sm" variant="primary">
                View detail
              </Button>
              <Button size="sm" variant="ghost">
                Upvote
              </Button>
            </CardFooter>
          </Card>
        </Section>

        <Section title="Modal, dropdown, tabs, tooltip">
          <div className="flex flex-wrap items-center gap-4">
            <Button onClick={() => setModalOpen(true)}>Open modal</Button>
            <Modal
              open={modalOpen}
              onClose={() => setModalOpen(false)}
              title="Confirm resolution?"
              description="This marks the complaint as resolved in your records."
              footer={
                <>
                  <Button variant="outline" onClick={() => setModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button variant="primary" onClick={() => setModalOpen(false)}>
                    Confirm
                  </Button>
                </>
              }
            >
              <p className="text-sm text-ink-muted">
                Focus is trapped in this dialog; Escape or the backdrop closes it.
              </p>
            </Modal>

            <Dropdown align="start">
              <DropdownTrigger>
                <Button variant="outline">Actions</Button>
              </DropdownTrigger>
              <DropdownMenu>
                <DropdownItem
                  onSelect={() => toast({ title: "Edited", variant: "success" })}
                >
                  <Pencil className="size-4" /> Edit
                </DropdownItem>
                <DropdownItem
                  destructive
                  onSelect={() => toast({ title: "Deleted", variant: "error" })}
                >
                  <Trash2 className="size-4" /> Delete
                </DropdownItem>
              </DropdownMenu>
            </Dropdown>

            <Tooltip content="Officers never see who filed a complaint">
              <Button variant="ghost">Hover for tooltip</Button>
            </Tooltip>

            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => toast({ title: "Saved successfully", variant: "success" })}
              >
                Success toast
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  toast({
                    title: "Something went wrong",
                    description: "Please try again.",
                    variant: "error",
                  })
                }
              >
                Error toast
              </Button>
            </div>
          </div>

          <div className="mt-6">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="all">All active</TabsTrigger>
                <TabsTrigger value="overdue">Overdue</TabsTrigger>
                <TabsTrigger value="unassigned">Unassigned</TabsTrigger>
              </TabsList>
              <TabsContent value="all" className="text-ink-muted mt-3 text-sm">
                Showing all active complaints in your zone.
              </TabsContent>
              <TabsContent value="overdue" className="text-ink-muted mt-3 text-sm">
                Showing complaints past their SLA target.
              </TabsContent>
              <TabsContent value="unassigned" className="text-ink-muted mt-3 text-sm">
                Showing complaints no officer has claimed yet.
              </TabsContent>
            </Tabs>
          </div>
        </Section>

        <Section title="Data table & pagination">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Code</TableHeaderCell>
                <TableHeaderCell>Category</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>SLA</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow>
                <TableCell className="font-mono">KRT-2026-000101</TableCell>
                <TableCell>Roads &amp; Potholes</TableCell>
                <TableCell>
                  <StatusPill status="IN_PROGRESS" />
                </TableCell>
                <TableCell>
                  <SlaPill sla="ON_TIME" />
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-mono">KRT-2026-000109</TableCell>
                <TableCell>Streetlights</TableCell>
                <TableCell>
                  <StatusPill status="UNDER_REVIEW" />
                </TableCell>
                <TableCell>
                  <SlaPill sla="OVERDUE" />
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <Pagination
            page={page}
            pageSize={10}
            total={94}
            onPageChange={setPage}
            className="mt-4"
          />
        </Section>

        <Section title="Empty state & skeleton">
          <div className="grid gap-6 sm:grid-cols-2">
            <EmptyState
              icon={Search}
              title="No complaints found"
              description="Try adjusting your filters or search term."
            />
            <div className="space-y-2">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-24 w-full" />
            </div>
          </div>
        </Section>

        <Section title="File dropzone">
          <div className="max-w-md">
            <FileDropzone file={file} onFileChange={setFile} />
          </div>
        </Section>

        <Section title="Map picker (Leaflet + OSM)">
          <MapPicker value={point} onChange={setPoint} className="max-w-2xl" />
          {point && (
            <p className="text-ink-faint mt-2 font-mono text-xs">
              {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
            </p>
          )}
        </Section>
      </main>
    </div>
  );
}
