import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  BotOff,
  Check,
  ChevronDown,
  ChevronUp,
  Info,
  Loader2,
  MapPin,
  MapPinned,
  Wand2,
  X as XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { LinkButton } from "@/components/ui/LinkButton";
import { DynamicIcon } from "@/components/DynamicIcon";
import { Textarea } from "@/components/ui/Textarea";
import { Label } from "@/components/ui/Label";
import { Combobox } from "@/components/ui/Combobox";
import { FileDropzone } from "@/components/ui/FileDropzone";
import { MapPicker, type LatLng } from "@/components/ui/MapPicker";
import { Skeleton } from "@/components/ui/Skeleton";
import { Stepper } from "@/components/ui/Stepper";
import { Tooltip } from "@/components/ui/Tooltip";
import { useToast } from "@/components/ui/Toast";
import { useCategories } from "@/hooks/useCategories";
import { useZones } from "@/hooks/useZones";
import { useSuggestZone } from "@/hooks/useSuggestZone";
import { useCreateComplaint } from "@/hooks/useCreateComplaint";
import { useLocalDraft } from "@/hooks/useLocalDraft";
import { useDirtyFormGuard } from "@/hooks/useDirtyFormGuard";
import { iconForCategory } from "@/lib/categoryIcons";
import { matchCategory } from "@/lib/categoryMatcher";
import { readExifGps, type ExifGps } from "@/lib/exifGps";
import { screeningPhase } from "@/lib/aiScreening";
import { getComplaintById } from "@/services/complaints";
import { ApiRequestError } from "@/services/http";
import { cn } from "@/lib/utils";
import type { Category, ComplaintDetail } from "@/types/api";

const STEP_LABELS = [
  "What happened",
  "Complaint Category",
  "Evidence & location",
  "Review",
];
const MIN_DESCRIPTION_LENGTH = 10;
const MAX_PHOTOS = 3;

interface WizardDraft {
  step: number;
  description: string;
  categoryId: string | null;
}

const EMPTY_DRAFT: WizardDraft = { step: 0, description: "", categoryId: null };

export function FileComplaintPage() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const { data: categories, isLoading: categoriesLoading } = useCategories();
  const { data: zones, isLoading: zonesLoading } = useZones();
  const suggestZoneMutation = useSuggestZone();
  const createComplaint = useCreateComplaint();

  const [draft, setDraft, { hasDraft, clearDraft }] = useLocalDraft<WizardDraft>(
    "file-complaint",
    EMPTY_DRAFT,
  );
  const [draftNoticeDismissed, setDraftNoticeDismissed] = useState(false);
  const { step, description, categoryId } = draft;

  function setStep(next: number | ((s: number) => number)) {
    setDraft((prev) => ({
      ...prev,
      step:
        typeof next === "function" ? (next as (s: number) => number)(prev.step) : next,
    }));
  }
  function setDescription(next: string) {
    setDraft((prev) => ({ ...prev, description: next }));
  }
  function setCategoryId(next: string | null) {
    setDraft((prev) => ({ ...prev, categoryId: next }));
  }

  // Step 2 — category
  const [regexSuggestedId, setRegexSuggestedId] = useState<string | null>(null);

  // Step 3 — evidence + location
  const [photos, setPhotos] = useState<File[]>([]);
  const [location, setLocation] = useState<LatLng | null>(null);
  const [zoneId, setZoneId] = useState<string>("");
  const [zoneManuallySet, setZoneManuallySet] = useState(false);
  // Keyed by file identity so "checking" is derived (not set synchronously
  // in the effect below) — it's simply "no result yet for this file".
  const [exifResult, setExifResult] = useState<{
    file: File;
    gps: ExifGps | null;
  } | null>(null);
  const [showManualMap, setShowManualMap] = useState(false);
  const exifStatus: "idle" | "checking" | "found" | "not-found" =
    photos.length === 0
      ? "idle"
      : exifResult?.file !== photos[0]
        ? "checking"
        : exifResult.gps
          ? "found"
          : "not-found";

  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<ComplaintDetail | null>(null);

  const isDirty =
    !submitted &&
    (description.trim().length > 0 ||
      categoryId != null ||
      photos.length > 0 ||
      step > 0);
  useDirtyFormGuard(isDirty);

  // Auto-read EXIF GPS from the first photo, falling back to the manual map
  // when it's absent — most demo/downloaded photos have no GPS tags at all.
  useEffect(() => {
    const firstPhoto = photos[0];
    if (!firstPhoto) return;
    let cancelled = false;
    readExifGps(firstPhoto).then((gps) => {
      if (cancelled) return;
      setExifResult({ file: firstPhoto, gps });
      if (gps) {
        setLocation(gps);
        setZoneManuallySet(false);
        setShowManualMap(false);
      } else {
        setShowManualMap(true);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos[0]]);

  // Zone auto-suggestion from whatever location is currently set (EXIF or manual pin).
  useEffect(() => {
    if (!location || zoneManuallySet) return;
    suggestZoneMutation.mutate(
      { latitude: location.lat, longitude: location.lng },
      {
        onSuccess: (result) => result.suggestedZone && setZoneId(result.suggestedZone.id),
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location?.lat, location?.lng, zoneManuallySet]);

  // Poll the freshly created complaint until every photo's AI screening
  // resolves (or reports itself unavailable) — mirrors the mock's real
  // background job instead of faking it.
  const { data: liveComplaint } = useQuery({
    queryKey: ["complaints", submitted?.id],
    queryFn: () => getComplaintById(submitted!.id),
    enabled: !!submitted,
    initialData: submitted ?? undefined,
    refetchInterval: (query) => {
      const current = query.state.data as ComplaintDetail | undefined;
      if (!current) return 1000;
      const allResolved = (current.evidence ?? []).every(
        (e) => screeningPhase(e.aiConfidenceNote) !== "pending",
      );
      return allResolved ? false : 1000;
    },
  });

  function goBack() {
    setFormError(null);
    setStep((s) => Math.max(0, s - 1));
  }

  function continueFromDescription() {
    // Only re-run the matcher while the current category is itself still the
    // regex's own suggestion (or unset) — once the citizen manually overrides
    // it on the next step, editing the description again must never clobber
    // that deliberate choice. This is also why a "no longer matches"
    // re-suggestion clears back to null instead of leaving the stale id.
    if (categories && categoryId === regexSuggestedId) {
      const match = matchCategory(description, categories);
      setCategoryId(match?.category.id ?? null);
      setRegexSuggestedId(match?.category.id ?? null);
    }
    setStep(1);
  }

  function pickCategory(id: string) {
    setCategoryId(id);
  }

  const canContinueDescription = description.trim().length >= MIN_DESCRIPTION_LENGTH;
  const canContinueCategory = !!categoryId;
  const canContinueEvidence = photos.length > 0 && !!location && !!zoneId;

  async function handleSubmit() {
    setFormError(null);
    if (!categoryId || photos.length === 0 || !location || !zoneId) return;

    try {
      const complaint = await createComplaint.mutateAsync({
        categoryId,
        description: description.trim() || undefined,
        photos,
        latitude: location.lat,
        longitude: location.lng,
        zoneId,
      });
      setSubmitted(complaint);
      clearDraft();
    } catch (error) {
      setFormError(
        error instanceof ApiRequestError
          ? error.message
          : "Something went wrong. Please try again.",
      );
    }
  }

  const selectedCategory = categories?.find((c) => c.id === categoryId) ?? null;
  const selectedZone = zones?.find((z) => z.id === zoneId) ?? null;

  function resetForm() {
    setStep(0);
    setDescription("");
    setCategoryId(null);
    setRegexSuggestedId(null);
    setPhotos([]);
    setLocation(null);
    setZoneId("");
    setZoneManuallySet(false);
    setExifResult(null);
    setShowManualMap(false);
    setFormError(null);
    setSubmitted(null);
  }

  if (submitted) {
    return (
      <SubmittedView
        complaint={liveComplaint ?? submitted}
        onViewComplaint={() => navigate(`/citizen/complaints/${submitted.id}`)}
        onFileAnother={() => {
          toast({ title: "Ready for the next report", variant: "default" });
          resetForm();
        }}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 pb-12">
      <div>
        <h1 className="font-display text-display-sm font-semibold text-ink">
          File a complaint
        </h1>
        <p className="text-ink-muted mt-1 text-sm">
          Let us know what problems you're facing.
        </p>
      </div>

      <Stepper steps={STEP_LABELS} currentStep={step} />

      {hasDraft && !draftNoticeDismissed && (
        <div className="border-brand/30 bg-brand/5 text-ink-muted flex items-center justify-between gap-3 rounded-md border px-4 py-2.5 text-sm">
          <span>Draft restored — pick up where you left off.</span>
          <button
            type="button"
            onClick={() => setDraftNoticeDismissed(true)}
            aria-label="Dismiss"
            className="text-ink-faint hover:text-ink shrink-0"
          >
            <XIcon className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {formError && (
        <p
          role="alert"
          className="bg-status-rejected-subtle text-status-rejected rounded-md px-4 py-3 text-sm"
        >
          {formError}
        </p>
      )}

      {step === 0 && (
        <section className="space-y-4 rounded-lg border border-line bg-surface p-6">
          <div>
            <Label htmlFor="description" required>
              What happened?
            </Label>
            <Textarea
              id="description"
              autoFocus
              rows={5}
              placeholder="e.g. There is a deep pothole in the middle of the road near the market…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              hint="A few sentences is enough — this also helps us guess the category on the next step."
            />
            <p
              className={cn(
                "mt-1.5 text-right text-xs",
                canContinueDescription
                  ? "text-ink-faint"
                  : "text-status-needs_more_evidence",
              )}
            >
              {description.trim().length}/{MIN_DESCRIPTION_LENGTH} characters minimum
            </p>
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              disabled={!canContinueDescription}
              onClick={continueFromDescription}
            >
              Continue
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="space-y-4 rounded-lg border border-line bg-surface p-6">
          <div>
            <Label required>Category</Label>
            {regexSuggestedId && (
              <p className="text-ink-muted mt-1 mb-3 flex items-center gap-1.5 text-sm">
                <Wand2 className="text-brand size-4 shrink-0" aria-hidden="true" />
                We tried guessing... change it below if it's wrong.
              </p>
            )}
            {!regexSuggestedId && (
              <p className="text-ink-muted mt-1 mb-3 text-sm">
                We couldn't guess a category from your description — pick the closest
                match.
              </p>
            )}
            {categoriesLoading ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {categories?.map((category) => (
                  <CategoryCard
                    key={category.id}
                    category={category}
                    selected={categoryId === category.id}
                    suggested={regexSuggestedId === category.id}
                    onSelect={() => pickCategory(category.id)}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-between">
            <Button type="button" variant="ghost" onClick={goBack}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back
            </Button>
            <Button
              type="button"
              disabled={!canContinueCategory}
              onClick={() => setStep(2)}
            >
              Continue
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="space-y-6 rounded-lg border border-line bg-surface p-6">
          <div>
            <Label required>Photo evidence</Label>
            <p className="text-ink-muted mb-3 text-sm">
              Up to {MAX_PHOTOS} photos. We'll try to read the location from the first one
              automatically.
            </p>
            <FileDropzone
              files={photos}
              onFilesChange={setPhotos}
              maxFiles={MAX_PHOTOS}
            />
            {photos.length > 1 && (
              <ReorderablePhotoList photos={photos} onReorder={setPhotos} />
            )}
          </div>

          <div>
            <Label required>Location</Label>
            {exifStatus === "checking" && (
              <p className="text-ink-muted mt-1 mb-3 flex items-center gap-1.5 text-sm">
                <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
                Checking the photo for a location…
              </p>
            )}
            {exifStatus === "found" && (
              <p className="text-ink-muted mt-1 mb-3 flex items-center gap-1.5 text-sm">
                <MapPin className="text-brand size-4 shrink-0" aria-hidden="true" />
                Location detected from your photo.{" "}
                <button
                  type="button"
                  onClick={() => setShowManualMap((v) => !v)}
                  className="text-brand underline underline-offset-2"
                >
                  {showManualMap ? "Hide map" : "Change manually"}
                </button>
              </p>
            )}
            {exifStatus === "not-found" && (
              <p className="text-ink-muted mt-1 mb-3 flex items-center gap-1.5 text-sm">
                <MapPinned className="size-4 shrink-0" aria-hidden="true" />
                Your photo didn't have a location saved in it — drop a pin below.
              </p>
            )}
            {exifStatus === "idle" && (
              <p className="text-ink-muted mt-1 mb-3 text-sm">
                Add a photo above, or drop a pin below.
              </p>
            )}
            {(showManualMap || exifStatus === "not-found" || exifStatus === "idle") && (
              <MapPicker value={location} onChange={setLocation} />
            )}
          </div>

          <div>
            <Label htmlFor="zoneId" required>
              Zone
            </Label>
            {zonesLoading ? (
              <Skeleton className="h-11 w-full" />
            ) : (
              <Combobox
                id="zoneId"
                value={zoneId}
                placeholderDisabled
                hint={
                  !zoneManuallySet && zoneId
                    ? "Auto-filled from the location above — change it if it's wrong."
                    : undefined
                }
                onChange={(v) => {
                  setZoneId(v);
                  setZoneManuallySet(true);
                }}
                options={[
                  { value: "", label: "Choose a zone…" },
                  ...(zones?.map((zone) => ({ value: zone.id, label: zone.name })) ?? []),
                ]}
              />
            )}
          </div>

          <div className="flex justify-between">
            <Button type="button" variant="ghost" onClick={goBack}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back
            </Button>
            <Button
              type="button"
              disabled={!canContinueEvidence}
              onClick={() => setStep(3)}
            >
              Continue
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="space-y-6 rounded-lg border border-line bg-surface p-6">
          <Label>Review</Label>

          <div className="space-y-4 text-sm">
            <ReviewRow label="Description">
              <p className="text-ink">{description || "—"}</p>
            </ReviewRow>
            <ReviewRow label="Category">
              {selectedCategory && (
                <div className="flex items-center gap-2 text-ink">
                  <DynamicIcon
                    icon={iconForCategory(selectedCategory.name)}
                    className="text-ink-muted size-4"
                    aria-hidden="true"
                  />
                  {selectedCategory.name}
                </div>
              )}
            </ReviewRow>
            <ReviewRow label="Zone">
              <p className="text-ink">{selectedZone?.name ?? "—"}</p>
            </ReviewRow>
            <ReviewRow label={`Photos (${photos.length})`}>
              <div className="flex gap-2">
                {photos.map((photo, i) => (
                  <PhotoThumb key={i} file={photo} />
                ))}
              </div>
            </ReviewRow>
          </div>

          <div className="flex justify-between">
            <Button type="button" variant="ghost" onClick={goBack}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back
            </Button>
            <Button
              type="button"
              size="lg"
              loading={createComplaint.isPending}
              onClick={handleSubmit}
            >
              Submit complaint
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

function ReviewRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-4 border-b border-line pb-4 last:border-0 last:pb-0">
      <p className="text-ink-faint">{label}</p>
      <div className="col-span-2">{children}</div>
    </div>
  );
}

function PhotoThumb({ file }: { file: File }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => {
    // Deferred — see the matching comment in FileDropzone's FilePreview.
    return () => void setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [url]);
  return (
    <img src={url} alt="Evidence preview" className="size-16 rounded-md object-cover" />
  );
}

function CategoryCard({
  category,
  selected,
  suggested,
  onSelect,
}: {
  category: Category;
  selected: boolean;
  suggested: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className={cn(
        "relative flex flex-col items-center gap-2 rounded-md border p-3 text-center transition-colors",
        selected ? "border-brand bg-brand/10" : "border-line hover:bg-surface-hover",
      )}
    >
      {suggested && (
        <span className="bg-brand text-brand-fg absolute -top-2 -right-2 flex size-5 items-center justify-center rounded-full">
          <Wand2 className="size-3" aria-hidden="true" />
        </span>
      )}
      {(category.description || category.slaTargetHours != null) && (
        <Tooltip
          side="top"
          content={
            <span className="block max-w-56 text-left">
              {category.description}
              {category.description && category.slaTargetHours != null && " · "}
              {category.slaTargetHours != null &&
                `Target: ${category.slaTargetHours}h to resolve`}
            </span>
          }
        >
          <button
            type="button"
            aria-label={`About ${category.name}`}
            className="text-ink-faint hover:text-ink absolute top-1.5 left-1.5"
          >
            <Info className="size-3.5" aria-hidden="true" />
          </button>
        </Tooltip>
      )}
      <button
        type="button"
        onClick={onSelect}
        className="flex flex-col items-center gap-2"
      >
        <DynamicIcon
          icon={iconForCategory(category.name)}
          className={cn("size-6", selected ? "text-brand" : "text-ink-muted")}
          aria-hidden="true"
        />
        <span className={cn("text-xs font-medium", selected ? "text-brand" : "text-ink")}>
          {category.name}
        </span>
      </button>
    </div>
  );
}

function ReorderablePhotoList({
  photos,
  onReorder,
}: {
  photos: File[];
  onReorder: (files: File[]) => void;
}) {
  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= photos.length) return;
    const next = [...photos];
    [next[index], next[target]] = [next[target], next[index]];
    onReorder(next);
  }

  return (
    <div className="mt-3 space-y-1.5">
      <p className="text-ink-faint text-xs">
        First photo drives the automatic location detection — reorder if needed.
      </p>
      <ul className="space-y-1.5">
        {photos.map((photo, i) => (
          <PhotoReorderRow
            key={i}
            file={photo}
            index={i}
            isFirst={i === 0}
            isLast={i === photos.length - 1}
            onMoveUp={() => move(i, -1)}
            onMoveDown={() => move(i, 1)}
          />
        ))}
      </ul>
    </div>
  );
}

function PhotoReorderRow({
  file,
  index,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
}: {
  file: File;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => {
    return () => void setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [url]);

  return (
    <li className="border-line bg-surface flex items-center gap-2 rounded-md border p-1.5">
      <img src={url} alt="" className="size-8 shrink-0 rounded object-cover" />
      <span className="text-ink-muted flex-1 text-xs">
        Photo {index + 1}
        {index === 0 && " (location source)"}
      </span>
      <button
        type="button"
        onClick={onMoveUp}
        disabled={isFirst}
        aria-label={`Move photo ${index + 1} earlier`}
        className="text-ink-faint hover:text-ink disabled:pointer-events-none disabled:opacity-30"
      >
        <ChevronUp className="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onMoveDown}
        disabled={isLast}
        aria-label={`Move photo ${index + 1} later`}
        className="text-ink-faint hover:text-ink disabled:pointer-events-none disabled:opacity-30"
      >
        <ChevronDown className="size-4" aria-hidden="true" />
      </button>
    </li>
  );
}

function SubmittedView({
  complaint,
  onViewComplaint,
  onFileAnother,
}: {
  complaint: ComplaintDetail;
  onViewComplaint: () => void;
  onFileAnother: () => void;
}) {
  const sortedEvidence = [...(complaint.evidence ?? [])].sort(
    (a, b) => a.sequence - b.sequence,
  );

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 pb-12">
      <div className="rounded-lg border border-line bg-surface p-6 text-center">
        <span className="bg-status-resolved-subtle text-status-resolved mx-auto flex size-12 items-center justify-center rounded-full">
          <Check className="size-6" aria-hidden="true" />
        </span>
        <h1 className="font-display mt-4 text-xl font-semibold text-ink">
          Complaint filed
        </h1>
        <p className="text-ink-muted mt-1 text-sm">
          Reference {complaint.id} — we'll keep you posted as it moves through review.
        </p>
      </div>

      <div className="space-y-3 rounded-lg border border-line bg-surface p-6">
        <p className="text-sm font-medium text-ink">AI photo screening</p>
        {sortedEvidence.map((evidence) => {
          const phase = screeningPhase(evidence.aiConfidenceNote);
          return (
            <div
              key={evidence.id}
              className="flex items-center gap-3 rounded-md border border-line p-3"
            >
              <img
                src={evidence.photoUrl}
                alt={`Evidence photo ${evidence.sequence}`}
                className="size-12 shrink-0 rounded object-cover"
              />
              <div className="text-ink-faint flex min-w-0 items-start gap-1.5 text-xs">
                {phase === "pending" ? (
                  <>
                    <Loader2
                      className="mt-0.5 size-3.5 shrink-0 animate-spin"
                      aria-hidden="true"
                    />
                    <span>Analyzing photo {evidence.sequence}…</span>
                  </>
                ) : phase === "done" ? (
                  <>
                    <Bot className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    <span>
                      {evidence.aiConfidenceNote?.note}
                      {evidence.aiConfidenceNote?.confidence != null &&
                        ` (${Math.round(evidence.aiConfidenceNote.confidence * 100)}% confidence)`}
                    </span>
                  </>
                ) : (
                  <>
                    <BotOff className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    <span>
                      AI screening was unavailable — an officer will review it directly.
                    </span>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="outline" onClick={onFileAnother}>
          File another
        </Button>
        <LinkButton to="/citizen" variant="ghost">
          Back to dashboard
        </LinkButton>
        <Button type="button" onClick={onViewComplaint}>
          View my complaint
        </Button>
      </div>
    </div>
  );
}
