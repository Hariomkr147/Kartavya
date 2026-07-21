import type {
  Database,
  UserRow,
  ZoneRow,
  CategoryRow,
  ClusterRow,
  ComplaintRow,
  EvidenceRow,
  StatusHistoryRow,
  NoteRow,
  UpvoteRow,
  PointsLedgerRow,
  BadgeRow,
  CitizenBadgeRow,
  ComplaintStatus,
  StatusActor,
  EvidenceVerdict,
  AiScreenStatus,
  PointsReason,
} from "./types";

/** now − hoursAgo, as an ISO string. Every seed timestamp is relative to load time. */
function iso(hoursAgo: number): string {
  return new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();
}

/**
 * Builds the initial in-memory database: a small, internally-consistent
 * "civic dataset" covering every complaint status, an SLA example in each
 * label (ON_TIME/DELAYED/OVERDUE), a live cluster with a cascade waiting to
 * happen, a dispute awaiting an admin verdict, and one citizen (Aditi) with
 * enough history to have earned most badges — deliberately not all of them,
 * so there's still a badge left to unlock live through the UI.
 */
export function createSeedData(): Database {
  // ---------------------------------------------------------------------
  // Zones
  // ---------------------------------------------------------------------
  const zones: ZoneRow[] = [
    {
      id: 1,
      zoneCode: "UNASSIGNED",
      zoneName: "Unassigned",
      centerLat: 0,
      centerLng: 0,
      isCatchAll: true,
      isActive: true,
      createdAt: iso(24 * 365),
    },
    {
      id: 2,
      zoneCode: "WARD-12-N",
      zoneName: "Ward 12 – North",
      centerLat: 12.9716,
      centerLng: 77.5946,
      isCatchAll: false,
      isActive: true,
      createdAt: iso(24 * 365),
    },
    {
      id: 3,
      zoneCode: "WARD-07-S",
      zoneName: "Ward 7 – South",
      centerLat: 12.951,
      centerLng: 77.5712,
      isCatchAll: false,
      isActive: true,
      createdAt: iso(24 * 365),
    },
    {
      id: 4,
      zoneCode: "WARD-14-C",
      zoneName: "Ward 14 – Central",
      centerLat: 12.935,
      centerLng: 77.61,
      isCatchAll: false,
      isActive: true,
      createdAt: iso(24 * 365),
    },
  ];

  // ---------------------------------------------------------------------
  // Categories (fixed list of 12)
  // ---------------------------------------------------------------------
  const categories: CategoryRow[] = [
    {
      id: 1,
      categoryCode: "POTHOLE",
      categoryName: "Pothole",
      description:
        "A hole in the road surface that can damage vehicles or injure people.",
      slaHours: 72,
      createdAt: iso(24 * 365),
    },
    {
      id: 2,
      categoryCode: "OPEN_MANHOLE",
      categoryName: "Open Manhole",
      description: "An uncovered or missing manhole cover — a serious fall hazard.",
      slaHours: 6,
      createdAt: iso(24 * 365),
    },
    {
      id: 3,
      categoryCode: "BROKEN_STREETLIGHT",
      categoryName: "Broken Street Light",
      description: "A street light that is damaged, flickering, or not working.",
      slaHours: 24,
      createdAt: iso(24 * 365),
    },
    {
      id: 4,
      categoryCode: "GARBAGE_OVERFLOW",
      categoryName: "Garbage Overflow",
      description: "An overflowing public garbage bin or an uncollected waste pile.",
      slaHours: 48,
      createdAt: iso(24 * 365),
    },
    {
      id: 5,
      categoryCode: "WATER_LEAKAGE",
      categoryName: "Water Leakage",
      description: "A burst or leaking pipe wasting water on a public road.",
      slaHours: 24,
      createdAt: iso(24 * 365),
    },
    {
      id: 6,
      categoryCode: "DRAINAGE_OVERFLOW",
      categoryName: "Drainage Overflow",
      description: "A blocked or overflowing storm drain causing waterlogging.",
      slaHours: 12,
      createdAt: iso(24 * 365),
    },
    {
      id: 7,
      categoryCode: "SEWAGE_BLOCKAGE",
      categoryName: "Sewage Blockage",
      description: "A blocked or overflowing sewage line.",
      slaHours: 24,
      createdAt: iso(24 * 365),
    },
    {
      id: 8,
      categoryCode: "DAMAGED_FOOTPATH",
      categoryName: "Damaged Footpath",
      description: "Broken, uneven, or missing footpath tiles or slabs.",
      slaHours: 96,
      createdAt: iso(24 * 365),
    },
    {
      id: 9,
      categoryCode: "FALLEN_TREE",
      categoryName: "Fallen Tree or Branch",
      description: "A fallen tree or branch obstructing a road or path.",
      slaHours: 12,
      createdAt: iso(24 * 365),
    },
    {
      id: 10,
      categoryCode: "STRAY_ANIMAL",
      categoryName: "Stray Animal Nuisance",
      description: "Aggressive or unmanaged stray animals posing a public risk.",
      slaHours: 48,
      createdAt: iso(24 * 365),
    },
    {
      id: 11,
      categoryCode: "ILLEGAL_DUMPING",
      categoryName: "Illegal Dumping",
      description: "Construction debris or waste dumped illegally in a public space.",
      slaHours: 48,
      createdAt: iso(24 * 365),
    },
    {
      id: 12,
      categoryCode: "TRAFFIC_SIGNAL_FAULT",
      categoryName: "Traffic Signal Malfunction",
      description: "A traffic signal that is stuck, dark, or malfunctioning.",
      slaHours: 6,
      createdAt: iso(24 * 365),
    },
  ];

  // ---------------------------------------------------------------------
  // Users — 1 admin, 3 officers (one per real zone), 8 citizens.
  // Every seeded account shares the same demo password (mock-only).
  // ---------------------------------------------------------------------
  const DEMO_PASSWORD = "password123";
  const users: UserRow[] = [
    {
      id: 1,
      fullName: "System Administrator",
      displayName: null,
      email: "admin@kartavya.gov",
      password: DEMO_PASSWORD,
      role: "ADMIN",
      zoneId: null,
      isActive: true,
      createdAt: iso(24 * 365),
    },
    {
      id: 2,
      fullName: "Rakesh Menon",
      displayName: null,
      email: "officer.ward12@kartavya.gov",
      password: DEMO_PASSWORD,
      role: "OFFICER",
      zoneId: 2,
      isActive: true,
      createdAt: iso(24 * 300),
    },
    {
      id: 3,
      fullName: "Ravi Kulkarni",
      displayName: null,
      email: "officer.ward07@kartavya.gov",
      password: DEMO_PASSWORD,
      role: "OFFICER",
      zoneId: 3,
      isActive: true,
      createdAt: iso(24 * 300),
    },
    {
      id: 4,
      fullName: "Priya Shenoy",
      displayName: null,
      email: "officer.ward14@kartavya.gov",
      password: DEMO_PASSWORD,
      role: "OFFICER",
      zoneId: 4,
      isActive: true,
      createdAt: iso(24 * 300),
    },
    {
      id: 5,
      fullName: "Aditi Rao",
      displayName: "aditi_r",
      email: "aditi@example.com",
      password: DEMO_PASSWORD,
      role: "CITIZEN",
      zoneId: 2,
      isActive: true,
      createdAt: iso(24 * 30),
    },
    {
      id: 6,
      fullName: "Asha Verma",
      displayName: "asha_v",
      email: "asha@example.com",
      password: DEMO_PASSWORD,
      role: "CITIZEN",
      zoneId: 3,
      isActive: true,
      createdAt: iso(24 * 28),
    },
    {
      id: 7,
      fullName: "Kiran Shetty",
      displayName: null,
      email: "kiran@example.com",
      password: DEMO_PASSWORD,
      role: "CITIZEN",
      zoneId: 2,
      isActive: true,
      createdAt: iso(24 * 26),
    },
    {
      id: 8,
      fullName: "Meera Iyer",
      displayName: "meera_i",
      email: "meera@example.com",
      password: DEMO_PASSWORD,
      role: "CITIZEN",
      zoneId: 4,
      isActive: true,
      createdAt: iso(24 * 24),
    },
    {
      id: 9,
      fullName: "Suresh Babu",
      displayName: null,
      email: "suresh@example.com",
      password: DEMO_PASSWORD,
      role: "CITIZEN",
      zoneId: 3,
      isActive: true,
      createdAt: iso(24 * 20),
    },
    {
      id: 10,
      fullName: "Divya Nair",
      displayName: "divya_n",
      email: "divya@example.com",
      password: DEMO_PASSWORD,
      role: "CITIZEN",
      zoneId: 2,
      isActive: true,
      createdAt: iso(24 * 18),
    },
    {
      id: 11,
      fullName: "Arjun Kumar",
      displayName: null,
      email: "arjun@example.com",
      password: DEMO_PASSWORD,
      role: "CITIZEN",
      zoneId: 4,
      isActive: true,
      createdAt: iso(24 * 16),
    },
    {
      id: 12,
      fullName: "Lakshmi Pillai",
      displayName: "lakshmi_p",
      email: "lakshmi@example.com",
      password: DEMO_PASSWORD,
      role: "CITIZEN",
      zoneId: 3,
      isActive: true,
      createdAt: iso(24 * 14),
    },
  ];

  // ---------------------------------------------------------------------
  // Badges (fixed catalog of 6)
  // ---------------------------------------------------------------------
  const badges: BadgeRow[] = [
    {
      id: 1,
      badgeCode: "KARTAVYA_INITIATE",
      badgeName: "Kartavya Initiate",
      description: "Filed your first complaint.",
      criteriaType: "FIRST_COMPLAINT",
      criteriaValue: null,
      criteriaCount: null,
      createdAt: iso(24 * 365),
    },
    {
      id: 2,
      badgeCode: "STREET_GUARDIAN",
      badgeName: "Street Guardian",
      description: "Had 5 complaints resolved and confirmed fixed.",
      criteriaType: "COMPLAINTS_CLOSED",
      criteriaValue: 5,
      criteriaCount: null,
      createdAt: iso(24 * 365),
    },
    {
      id: 3,
      badgeCode: "ZONE_CHAMPION",
      badgeName: "Zone Champion",
      description: "Ranked #1 on your zone's leaderboard.",
      criteriaType: "ZONE_RANK_ONE",
      criteriaValue: null,
      criteriaCount: null,
      createdAt: iso(24 * 365),
    },
    {
      id: 4,
      badgeCode: "CENTURY_REFORMER",
      badgeName: "Century Reformer",
      description: "Earned 100 lifetime Community Service Points.",
      criteriaType: "LIFETIME_POINTS",
      criteriaValue: 100,
      criteriaCount: null,
      createdAt: iso(24 * 365),
    },
    {
      id: 5,
      badgeCode: "CIVIC_HERO",
      badgeName: "Civic Hero",
      description: "Earned 500 lifetime Community Service Points.",
      criteriaType: "LIFETIME_POINTS",
      criteriaValue: 500,
      criteriaCount: null,
      createdAt: iso(24 * 365),
    },
    {
      id: 6,
      badgeCode: "SWIFT_REPORTER",
      badgeName: "Swift Reporter",
      description: "Had 3 complaints closed within 7 days of each other.",
      criteriaType: "CLOSED_WITHIN_DAYS",
      criteriaValue: 7,
      criteriaCount: 3,
      createdAt: iso(24 * 365),
    },
  ];

  // ---------------------------------------------------------------------
  // Complaints, evidence, status history, notes, upvotes, points, badges
  // ---------------------------------------------------------------------
  const complaints: ComplaintRow[] = [];
  const evidence: EvidenceRow[] = [];
  const statusHistory: StatusHistoryRow[] = [];
  const notes: NoteRow[] = [];
  const upvotes: UpvoteRow[] = [];
  const pointsLedger: PointsLedgerRow[] = [];
  const citizenBadges: CitizenBadgeRow[] = [];

  let evidenceId = 1;
  let historyId = 1;
  let noteId = 1;
  let upvoteId = 1;
  let pointsId = 1;
  let citizenBadgeId = 1;

  function pushHistory(
    complaintId: number,
    from: ComplaintStatus | null,
    to: ComplaintStatus,
    actorRole: StatusActor,
    changedByUserId: number | null,
    hoursAgo: number,
    reason: string | null = null,
    remark: string | null = null,
  ) {
    statusHistory.push({
      id: historyId++,
      complaintId,
      fromStatus: from,
      toStatus: to,
      actorRole,
      changedByUserId,
      reason,
      remark,
      createdAt: iso(hoursAgo),
    });
  }

  function pushEvidence(
    complaintId: number,
    sequence: number,
    hoursAgo: number,
    opts: {
      aiScreenStatus?: AiScreenStatus;
      aiMatchesCategory?: boolean | null;
      aiConfidence?: number | null;
      aiNote?: string | null;
      verdict?: EvidenceVerdict | null;
      verdictReason?: string | null;
      reviewedBy?: number | null;
      reviewedHoursAgo?: number;
    } = {},
  ) {
    evidence.push({
      id: evidenceId++,
      complaintId,
      sequence,
      filePath: `/uploads/complaints/${complaintId}/${sequence}.jpg`,
      aiScreenStatus: opts.aiScreenStatus ?? "DONE",
      aiMatchesCategory: opts.aiMatchesCategory ?? true,
      aiConfidence: opts.aiConfidence ?? 0.86,
      aiNote: opts.aiNote ?? "Photo appears consistent with the selected category.",
      verdict: opts.verdict ?? null,
      verdictReason: opts.verdictReason ?? null,
      reviewedBy: opts.reviewedBy ?? null,
      reviewedAt: opts.reviewedBy ? iso(opts.reviewedHoursAgo ?? hoursAgo) : null,
      createdAt: iso(hoursAgo),
    });
  }

  function pushPoints(
    citizenId: number,
    complaintId: number | null,
    pointsChange: number,
    reason: PointsReason,
    hoursAgo: number,
  ) {
    pointsLedger.push({
      id: pointsId++,
      citizenId,
      complaintId,
      pointsChange,
      reason,
      createdAt: iso(hoursAgo),
    });
  }

  function pushUpvote(complaintId: number, citizenId: number, hoursAgo: number) {
    upvotes.push({ id: upvoteId++, complaintId, citizenId, createdAt: iso(hoursAgo) });
  }

  // --- Cluster #1: three Pothole reports within ~40m of each other, Ward 12 – North ---
  const cluster1: ClusterRow = {
    id: 1,
    categoryId: 1,
    zoneId: 2,
    centroidLat: 12.97177,
    centroidLng: 77.59463,
    reportCount: 3,
    uniqueReporterCount: 3,
    rewardGranted: false,
    createdAt: iso(24 * 7),
    updatedAt: iso(24 * 5),
  };

  // C101 — Aditi, UNDER_RESOLUTION, cluster member, 2 upvotes
  complaints.push({
    id: 101,
    complaintCode: "KTV-2026-000101",
    citizenId: 5,
    zoneId: 2,
    categoryId: 1,
    clusterId: 1,
    assignedOfficerId: 2,
    description:
      "Deep pothole right next to the bus stop — cars are swerving to avoid it.",
    categoryAiSuggested: true,
    latitude: 12.9716,
    longitude: 77.5946,
    status: "UNDER_RESOLUTION",
    severityScore: 8, // (3-1)*3 + 2 upvotes
    slaTargetHours: 72,
    slaStartedAt: iso(24 * 8.5),
    slaPausedSeconds: 0,
    slaPausedAt: null,
    createdAt: iso(24 * 9),
    updatedAt: iso(24 * 2),
    resolvedAt: null,
    closedAt: null,
  });
  pushEvidence(101, 1, 24 * 9, { reviewedBy: 2, reviewedHoursAgo: 24 * 8.5 });
  pushHistory(101, null, "SUBMITTED", "CITIZEN", 5, 24 * 9);
  pushHistory(101, "SUBMITTED", "EVIDENCE_UNDER_REVIEW", "OFFICER", 2, 24 * 8.7);
  pushHistory(101, "EVIDENCE_UNDER_REVIEW", "UNDER_REVIEW", "OFFICER", 2, 24 * 8.5);
  pushHistory(101, "UNDER_REVIEW", "IN_PROGRESS", "OFFICER", 2, 24 * 6);
  pushHistory(101, "IN_PROGRESS", "UNDER_RESOLUTION", "OFFICER", 2, 24 * 2);
  pushUpvote(101, 7, 24 * 4);
  pushUpvote(101, 10, 24 * 3);
  pushPoints(5, 101, 5, "UPVOTE_RECEIVED", 24 * 4);
  pushPoints(5, 101, 5, "UPVOTE_RECEIVED", 24 * 3);
  notes.push({
    id: noteId++,
    complaintId: 101,
    officerId: 2,
    noteText: "Inspected the site. Repair crew scheduled for this week.",
    createdAt: iso(24 * 2),
  });

  // C102 — Kiran, IN_PROGRESS, cluster member, 1 upvote
  complaints.push({
    id: 102,
    complaintCode: "KTV-2026-000102",
    citizenId: 7,
    zoneId: 2,
    categoryId: 1,
    clusterId: 1,
    assignedOfficerId: 2,
    description: "Same pothole — got worse after last night's rain.",
    categoryAiSuggested: false,
    latitude: 12.97195,
    longitude: 77.5948,
    status: "IN_PROGRESS",
    severityScore: 7, // (3-1)*3 + 1 upvote
    slaTargetHours: 72,
    slaStartedAt: iso(24 * 6.5),
    slaPausedSeconds: 0,
    slaPausedAt: null,
    createdAt: iso(24 * 7),
    updatedAt: iso(24 * 4),
    resolvedAt: null,
    closedAt: null,
  });
  pushEvidence(102, 1, 24 * 7, { reviewedBy: 2, reviewedHoursAgo: 24 * 6.5 });
  pushHistory(102, null, "SUBMITTED", "CITIZEN", 7, 24 * 7);
  pushHistory(102, "SUBMITTED", "EVIDENCE_UNDER_REVIEW", "OFFICER", 2, 24 * 6.8);
  pushHistory(102, "EVIDENCE_UNDER_REVIEW", "UNDER_REVIEW", "OFFICER", 2, 24 * 6.5);
  pushHistory(102, "UNDER_REVIEW", "IN_PROGRESS", "OFFICER", 2, 24 * 4);
  pushUpvote(102, 5, 24 * 2);
  pushPoints(7, 102, 5, "UPVOTE_RECEIVED", 24 * 2);

  // C103 — Divya, UNDER_REVIEW, cluster member, no upvotes yet
  complaints.push({
    id: 103,
    complaintCode: "KTV-2026-000103",
    citizenId: 10,
    zoneId: 2,
    categoryId: 1,
    clusterId: 1,
    assignedOfficerId: 2,
    description: "Reporting the same pothole cluster near the bus stop.",
    categoryAiSuggested: true,
    latitude: 12.97175,
    longitude: 77.5945,
    status: "UNDER_REVIEW",
    severityScore: 6, // (3-1)*3 + 0 upvotes
    slaTargetHours: 72,
    slaStartedAt: iso(24 * 4.5),
    slaPausedSeconds: 0,
    slaPausedAt: null,
    createdAt: iso(24 * 5),
    updatedAt: iso(24 * 4.5),
    resolvedAt: null,
    closedAt: null,
  });
  pushEvidence(103, 1, 24 * 5, { reviewedBy: 2, reviewedHoursAgo: 24 * 4.5 });
  pushHistory(103, null, "SUBMITTED", "CITIZEN", 10, 24 * 5);
  pushHistory(103, "SUBMITTED", "EVIDENCE_UNDER_REVIEW", "OFFICER", 2, 24 * 4.7);
  pushHistory(103, "EVIDENCE_UNDER_REVIEW", "UNDER_REVIEW", "OFFICER", 2, 24 * 4.5);

  // C104 — Asha, RESOLVED then disputed -> REOPENED, awaiting admin dispute-review
  complaints.push({
    id: 104,
    complaintCode: "KTV-2026-000104",
    citizenId: 6,
    zoneId: 3,
    categoryId: 4,
    clusterId: null,
    assignedOfficerId: 3,
    description: "Garbage bin outside the market has not been emptied in two weeks.",
    categoryAiSuggested: false,
    latitude: 12.952,
    longitude: 77.5718,
    status: "REOPENED",
    severityScore: 0,
    slaTargetHours: 48,
    slaStartedAt: iso(24 * 18),
    slaPausedSeconds: 0,
    slaPausedAt: null,
    createdAt: iso(24 * 20),
    updatedAt: iso(24 * 1),
    resolvedAt: iso(24 * 3),
    closedAt: null,
  });
  pushEvidence(104, 1, 24 * 20, { reviewedBy: 3, reviewedHoursAgo: 24 * 18 });
  pushEvidence(104, 2, 24 * 1, {
    aiScreenStatus: "DONE",
    aiNote: "Photo shows an overflowing bin, consistent with the citizen's dispute.",
    verdict: null,
    verdictReason: null,
  });
  pushHistory(104, null, "SUBMITTED", "CITIZEN", 6, 24 * 20);
  pushHistory(104, "SUBMITTED", "EVIDENCE_UNDER_REVIEW", "OFFICER", 3, 24 * 19);
  pushHistory(104, "EVIDENCE_UNDER_REVIEW", "UNDER_REVIEW", "OFFICER", 3, 24 * 18);
  pushHistory(104, "UNDER_REVIEW", "IN_PROGRESS", "OFFICER", 3, 24 * 12);
  pushHistory(104, "IN_PROGRESS", "UNDER_RESOLUTION", "OFFICER", 3, 24 * 5);
  pushHistory(
    104,
    "UNDER_RESOLUTION",
    "RESOLVED",
    "OFFICER",
    3,
    24 * 3,
    null,
    "Bin emptied and collection schedule confirmed with the contractor.",
  );
  pushHistory(
    104,
    "RESOLVED",
    "REOPENED",
    "CITIZEN",
    6,
    24 * 1,
    "Garbage is still piled up — nothing was actually collected.",
  );

  // C105 — Suresh, NEEDS_MORE_EVIDENCE (pre-acceptance loop, SLA never started)
  complaints.push({
    id: 105,
    complaintCode: "KTV-2026-000105",
    citizenId: 9,
    zoneId: 3,
    categoryId: 3,
    clusterId: null,
    assignedOfficerId: 3,
    description: "Street light has been out for a week near the school gate.",
    categoryAiSuggested: false,
    latitude: 12.9505,
    longitude: 77.5715,
    status: "NEEDS_MORE_EVIDENCE",
    severityScore: 0,
    slaTargetHours: null,
    slaStartedAt: null,
    slaPausedSeconds: 0,
    slaPausedAt: null,
    createdAt: iso(24 * 3),
    updatedAt: iso(24 * 1),
    resolvedAt: null,
    closedAt: null,
  });
  pushEvidence(105, 1, 24 * 3, {
    aiScreenStatus: "DONE",
    aiConfidence: 0.41,
    aiNote: "Image too dark to confirm the fault with confidence.",
    verdict: "NEEDS_MORE_EVIDENCE",
    verdictReason:
      "Photo too dark to confirm the light is broken — please retake in daylight.",
    reviewedBy: 3,
    reviewedHoursAgo: 24 * 1,
  });
  pushHistory(105, null, "SUBMITTED", "CITIZEN", 9, 24 * 3);
  pushHistory(105, "SUBMITTED", "EVIDENCE_UNDER_REVIEW", "OFFICER", 3, 24 * 2);
  pushHistory(
    105,
    "EVIDENCE_UNDER_REVIEW",
    "NEEDS_MORE_EVIDENCE",
    "OFFICER",
    3,
    24 * 1,
    "Photo too dark to confirm the light is broken — please retake in daylight.",
  );

  // C106 — Meera, NEEDS_MORE_EVIDENCE (post-acceptance recall; SLA paused)
  complaints.push({
    id: 106,
    complaintCode: "KTV-2026-000106",
    citizenId: 8,
    zoneId: 4,
    categoryId: 5,
    clusterId: null,
    assignedOfficerId: 4,
    description: "Pipe leaking steadily onto the road outside the apartment gate.",
    categoryAiSuggested: true,
    latitude: 12.9352,
    longitude: 77.6103,
    status: "NEEDS_MORE_EVIDENCE",
    severityScore: 0,
    slaTargetHours: 24,
    slaStartedAt: iso(24 * 3.5),
    slaPausedSeconds: 0,
    slaPausedAt: iso(12),
    createdAt: iso(24 * 4),
    updatedAt: iso(12),
    resolvedAt: null,
    closedAt: null,
  });
  pushEvidence(106, 1, 24 * 4, { reviewedBy: 4, reviewedHoursAgo: 24 * 3.5 });
  pushHistory(106, null, "SUBMITTED", "CITIZEN", 8, 24 * 4);
  pushHistory(106, "SUBMITTED", "EVIDENCE_UNDER_REVIEW", "OFFICER", 4, 24 * 3.8);
  pushHistory(106, "EVIDENCE_UNDER_REVIEW", "UNDER_REVIEW", "OFFICER", 4, 24 * 3.5);
  pushHistory(
    106,
    "UNDER_REVIEW",
    "NEEDS_MORE_EVIDENCE",
    "OFFICER",
    4,
    12,
    "Need a clearer photo showing the leak source — the current one is too far away.",
  );

  // C107 — Lakshmi, REJECTED (first evidence round)
  complaints.push({
    id: 107,
    complaintCode: "KTV-2026-000107",
    citizenId: 12,
    zoneId: 3,
    categoryId: 10,
    clusterId: null,
    assignedOfficerId: 3,
    description: "Aggressive stray dogs near the park entrance.",
    categoryAiSuggested: false,
    latitude: 12.9515,
    longitude: 77.571,
    status: "REJECTED",
    severityScore: 0,
    slaTargetHours: null,
    slaStartedAt: null,
    slaPausedSeconds: 0,
    slaPausedAt: null,
    createdAt: iso(24 * 6),
    updatedAt: iso(24 * 5),
    resolvedAt: null,
    closedAt: null,
  });
  pushEvidence(107, 1, 24 * 6, {
    aiScreenStatus: "DONE",
    aiMatchesCategory: false,
    aiConfidence: 0.62,
    aiNote: "Image shows a leashed dog, which may not match a stray-animal report.",
    verdict: "REJECTED",
    verdictReason:
      "Photo shows a pet dog on a leash, not a stray — not a valid complaint.",
    reviewedBy: 3,
    reviewedHoursAgo: 24 * 5,
  });
  pushHistory(107, null, "SUBMITTED", "CITIZEN", 12, 24 * 6);
  pushHistory(107, "SUBMITTED", "EVIDENCE_UNDER_REVIEW", "OFFICER", 3, 24 * 5.5);
  pushHistory(
    107,
    "EVIDENCE_UNDER_REVIEW",
    "REJECTED",
    "OFFICER",
    3,
    24 * 5,
    "Photo shows a pet dog on a leash, not a stray — not a valid complaint.",
  );
  pushPoints(12, 107, -20, "REJECTED_PENALTY", 24 * 5);

  // C108 — Arjun, UNRESOLVABLE
  complaints.push({
    id: 108,
    complaintCode: "KTV-2026-000108",
    citizenId: 11,
    zoneId: 4,
    categoryId: 11,
    clusterId: null,
    assignedOfficerId: 4,
    description: "Construction debris dumped on the vacant plot behind the temple.",
    categoryAiSuggested: false,
    latitude: 12.9355,
    longitude: 77.6105,
    status: "UNRESOLVABLE",
    severityScore: 0,
    slaTargetHours: 48,
    slaStartedAt: iso(24 * 14.5),
    slaPausedSeconds: 0,
    slaPausedAt: null,
    createdAt: iso(24 * 15),
    updatedAt: iso(24 * 2),
    resolvedAt: null,
    closedAt: null,
  });
  pushEvidence(108, 1, 24 * 15, { reviewedBy: 4, reviewedHoursAgo: 24 * 14.5 });
  pushHistory(108, null, "SUBMITTED", "CITIZEN", 11, 24 * 15);
  pushHistory(108, "SUBMITTED", "EVIDENCE_UNDER_REVIEW", "OFFICER", 4, 24 * 14.7);
  pushHistory(108, "EVIDENCE_UNDER_REVIEW", "UNDER_REVIEW", "OFFICER", 4, 24 * 14.5);
  pushHistory(108, "UNDER_REVIEW", "IN_PROGRESS", "OFFICER", 4, 24 * 10);
  pushHistory(
    108,
    "IN_PROGRESS",
    "UNRESOLVABLE",
    "OFFICER",
    4,
    24 * 2,
    "Site is under active legal dispute over land ownership — municipal crew cannot access it until resolved.",
  );

  // C109 — Kiran, IN_PROGRESS, Open Manhole (6h SLA) — badly OVERDUE, 1 upvote
  complaints.push({
    id: 109,
    complaintCode: "KTV-2026-000109",
    citizenId: 7,
    zoneId: 2,
    categoryId: 2,
    clusterId: null,
    assignedOfficerId: 2,
    description: "Open manhole in the middle of the lane, no barricade.",
    categoryAiSuggested: true,
    latitude: 12.972,
    longitude: 77.5949,
    status: "IN_PROGRESS",
    severityScore: 1,
    slaTargetHours: 6,
    slaStartedAt: iso(24 * 3.9),
    slaPausedSeconds: 0,
    slaPausedAt: null,
    createdAt: iso(24 * 4),
    updatedAt: iso(24 * 3.5),
    resolvedAt: null,
    closedAt: null,
  });
  pushEvidence(109, 1, 24 * 4, { reviewedBy: 2, reviewedHoursAgo: 24 * 3.9 });
  pushHistory(109, null, "SUBMITTED", "CITIZEN", 7, 24 * 4);
  pushHistory(109, "SUBMITTED", "EVIDENCE_UNDER_REVIEW", "OFFICER", 2, 24 * 3.95);
  pushHistory(109, "EVIDENCE_UNDER_REVIEW", "UNDER_REVIEW", "OFFICER", 2, 24 * 3.9);
  pushHistory(109, "UNDER_REVIEW", "IN_PROGRESS", "OFFICER", 2, 24 * 3.5);
  pushUpvote(109, 5, 24 * 2);
  pushPoints(7, 109, 5, "UPVOTE_RECEIVED", 24 * 2);

  // C110 — Divya, UNDER_REVIEW, Damaged Footpath (96h SLA) — DELAYED
  complaints.push({
    id: 110,
    complaintCode: "KTV-2026-000110",
    citizenId: 10,
    zoneId: 2,
    categoryId: 8,
    clusterId: null,
    assignedOfficerId: 2,
    description: "Several footpath slabs are broken and shifting underfoot.",
    categoryAiSuggested: false,
    latitude: 12.9714,
    longitude: 77.5944,
    status: "UNDER_REVIEW",
    severityScore: 0,
    slaTargetHours: 96,
    slaStartedAt: iso(90),
    slaPausedSeconds: 0,
    slaPausedAt: null,
    createdAt: iso(24 * 4),
    updatedAt: iso(90),
    resolvedAt: null,
    closedAt: null,
  });
  pushEvidence(110, 1, 24 * 4, { reviewedBy: 2, reviewedHoursAgo: 90 });
  pushHistory(110, null, "SUBMITTED", "CITIZEN", 10, 24 * 4);
  pushHistory(110, "SUBMITTED", "EVIDENCE_UNDER_REVIEW", "OFFICER", 2, 91);
  pushHistory(110, "EVIDENCE_UNDER_REVIEW", "UNDER_REVIEW", "OFFICER", 2, 90);

  // C111 — Meera, IN_PROGRESS, Drainage Overflow (12h SLA) — ON_TIME
  complaints.push({
    id: 111,
    complaintCode: "KTV-2026-000111",
    citizenId: 8,
    zoneId: 4,
    categoryId: 6,
    clusterId: null,
    assignedOfficerId: 4,
    description: "Storm drain blocked with plastic waste, water pooling on the road.",
    categoryAiSuggested: true,
    latitude: 12.9348,
    longitude: 77.6098,
    status: "IN_PROGRESS",
    severityScore: 0,
    slaTargetHours: 12,
    slaStartedAt: iso(8),
    slaPausedSeconds: 0,
    slaPausedAt: null,
    createdAt: iso(10),
    updatedAt: iso(7),
    resolvedAt: null,
    closedAt: null,
  });
  pushEvidence(111, 1, 10, { reviewedBy: 4, reviewedHoursAgo: 8 });
  pushHistory(111, null, "SUBMITTED", "CITIZEN", 8, 10);
  pushHistory(111, "SUBMITTED", "EVIDENCE_UNDER_REVIEW", "OFFICER", 4, 9);
  pushHistory(111, "EVIDENCE_UNDER_REVIEW", "UNDER_REVIEW", "OFFICER", 4, 8);
  pushHistory(111, "UNDER_REVIEW", "IN_PROGRESS", "OFFICER", 4, 7);

  // C112–C114 — fresh SUBMITTED, unclaimed, one per zone
  complaints.push({
    id: 112,
    complaintCode: "KTV-2026-000112",
    citizenId: 10,
    zoneId: 2,
    categoryId: 4,
    clusterId: null,
    assignedOfficerId: null,
    description: "Bin near the park entrance overflowing since yesterday.",
    categoryAiSuggested: false,
    latitude: 12.9718,
    longitude: 77.5943,
    status: "SUBMITTED",
    severityScore: 0,
    slaTargetHours: null,
    slaStartedAt: null,
    slaPausedSeconds: 0,
    slaPausedAt: null,
    createdAt: iso(5),
    updatedAt: iso(5),
    resolvedAt: null,
    closedAt: null,
  });
  pushEvidence(112, 1, 5, {
    aiScreenStatus: "PENDING",
    verdict: null,
    aiMatchesCategory: null,
    aiConfidence: null,
    aiNote: null,
  });
  pushHistory(112, null, "SUBMITTED", "CITIZEN", 10, 5);

  complaints.push({
    id: 113,
    complaintCode: "KTV-2026-000113",
    citizenId: 9,
    zoneId: 3,
    categoryId: 9,
    clusterId: null,
    assignedOfficerId: null,
    description: "Branch came down in last night's storm, blocking half the lane.",
    categoryAiSuggested: false,
    latitude: 12.9508,
    longitude: 77.5716,
    status: "SUBMITTED",
    severityScore: 0,
    slaTargetHours: null,
    slaStartedAt: null,
    slaPausedSeconds: 0,
    slaPausedAt: null,
    createdAt: iso(2),
    updatedAt: iso(2),
    resolvedAt: null,
    closedAt: null,
  });
  pushEvidence(113, 1, 2, {
    aiScreenStatus: "PENDING",
    verdict: null,
    aiMatchesCategory: null,
    aiConfidence: null,
    aiNote: null,
  });
  pushHistory(113, null, "SUBMITTED", "CITIZEN", 9, 2);

  complaints.push({
    id: 114,
    complaintCode: "KTV-2026-000114",
    citizenId: 11,
    zoneId: 4,
    categoryId: 12,
    clusterId: null,
    assignedOfficerId: null,
    description: "Signal stuck on red in all directions at the main junction.",
    categoryAiSuggested: true,
    latitude: 12.9353,
    longitude: 77.6102,
    status: "SUBMITTED",
    severityScore: 0,
    slaTargetHours: null,
    slaStartedAt: null,
    slaPausedSeconds: 0,
    slaPausedAt: null,
    createdAt: iso(1),
    updatedAt: iso(1),
    resolvedAt: null,
    closedAt: null,
  });
  pushEvidence(114, 1, 1, {
    aiScreenStatus: "UNAVAILABLE",
    verdict: null,
    aiMatchesCategory: null,
    aiConfidence: null,
    aiNote: null,
  });
  pushHistory(114, null, "SUBMITTED", "CITIZEN", 11, 1);

  // C115–C116 — claimed, awaiting evidence verdict
  complaints.push({
    id: 115,
    complaintCode: "KTV-2026-000115",
    citizenId: 5,
    zoneId: 2,
    categoryId: 3,
    clusterId: null,
    assignedOfficerId: 2,
    description: "Street light flickers all night then goes dark by 2am.",
    categoryAiSuggested: false,
    latitude: 12.9717,
    longitude: 77.5947,
    status: "EVIDENCE_UNDER_REVIEW",
    severityScore: 0,
    slaTargetHours: null,
    slaStartedAt: null,
    slaPausedSeconds: 0,
    slaPausedAt: null,
    createdAt: iso(24),
    updatedAt: iso(3),
    resolvedAt: null,
    closedAt: null,
  });
  pushEvidence(115, 1, 24, { aiConfidence: 0.77 });
  pushHistory(115, null, "SUBMITTED", "CITIZEN", 5, 24);
  pushHistory(115, "SUBMITTED", "EVIDENCE_UNDER_REVIEW", "OFFICER", 2, 3);

  complaints.push({
    id: 116,
    complaintCode: "KTV-2026-000116",
    citizenId: 12,
    zoneId: 3,
    categoryId: 7,
    clusterId: null,
    assignedOfficerId: 3,
    description: "Sewage backing up onto the street near the corner shop.",
    categoryAiSuggested: true,
    latitude: 12.9512,
    longitude: 77.5714,
    status: "EVIDENCE_UNDER_REVIEW",
    severityScore: 0,
    slaTargetHours: null,
    slaStartedAt: null,
    slaPausedSeconds: 0,
    slaPausedAt: null,
    createdAt: iso(24),
    updatedAt: iso(2),
    resolvedAt: null,
    closedAt: null,
  });
  pushEvidence(116, 1, 24, { aiConfidence: 0.91 });
  pushHistory(116, null, "SUBMITTED", "CITIZEN", 12, 24);
  pushHistory(116, "SUBMITTED", "EVIDENCE_UNDER_REVIEW", "OFFICER", 3, 2);

  // --- C120–C124: Aditi's 5 standalone, already-CLOSED complaints ---
  // Gives her: KARTAVYA_INITIATE, STREET_GUARDIAN (5 closed), SWIFT_REPORTER
  // (4 of these closed within the last 7 days), CENTURY_REFORMER (>=100 CSP),
  // and ZONE_CHAMPION (highest CSP in Ward 12 – North) — but deliberately
  // short of CIVIC_HERO (500 CSP), so one badge is still reachable live.
  const closedSeeds: {
    id: number;
    code: string;
    categoryId: number;
    submittedHoursAgo: number;
    closedHoursAgo: number;
    onTimeBonus: boolean;
  }[] = [
    {
      id: 120,
      code: "KTV-2026-000120",
      categoryId: 1,
      submittedHoursAgo: 24 * 25,
      closedHoursAgo: 24 * 20,
      onTimeBonus: true,
    },
    {
      id: 121,
      code: "KTV-2026-000121",
      categoryId: 3,
      submittedHoursAgo: 24 * 12,
      closedHoursAgo: 24 * 6,
      onTimeBonus: true,
    },
    {
      id: 122,
      code: "KTV-2026-000122",
      categoryId: 4,
      submittedHoursAgo: 24 * 10,
      closedHoursAgo: 24 * 4,
      onTimeBonus: true,
    },
    {
      id: 123,
      code: "KTV-2026-000123",
      categoryId: 8,
      submittedHoursAgo: 24 * 9,
      closedHoursAgo: 24 * 2,
      onTimeBonus: false,
    },
    {
      id: 124,
      code: "KTV-2026-000124",
      categoryId: 5,
      submittedHoursAgo: 24 * 8,
      closedHoursAgo: 24 * 1,
      onTimeBonus: true,
    },
  ];
  for (const seed of closedSeeds) {
    const category = categories.find((c) => c.id === seed.categoryId)!;
    const acceptedHoursAgo = seed.submittedHoursAgo - 2;
    complaints.push({
      id: seed.id,
      complaintCode: seed.code,
      citizenId: 5,
      zoneId: 2,
      categoryId: seed.categoryId,
      clusterId: null,
      assignedOfficerId: 2,
      description: `${category.categoryName} issue, since resolved and confirmed fixed.`,
      categoryAiSuggested: false,
      latitude: 12.9716 + (seed.id - 120) * 0.001,
      longitude: 77.5946 + (seed.id - 120) * 0.001,
      status: "CLOSED",
      severityScore: 0,
      slaTargetHours: category.slaHours,
      slaStartedAt: iso(acceptedHoursAgo),
      slaPausedSeconds: 0,
      slaPausedAt: null,
      createdAt: iso(seed.submittedHoursAgo),
      updatedAt: iso(seed.closedHoursAgo),
      resolvedAt: iso(seed.closedHoursAgo + 6),
      closedAt: iso(seed.closedHoursAgo),
    });
    pushEvidence(seed.id, 1, seed.submittedHoursAgo, {
      reviewedBy: 2,
      reviewedHoursAgo: acceptedHoursAgo,
    });
    pushHistory(seed.id, null, "SUBMITTED", "CITIZEN", 5, seed.submittedHoursAgo);
    pushHistory(
      seed.id,
      "SUBMITTED",
      "EVIDENCE_UNDER_REVIEW",
      "OFFICER",
      2,
      seed.submittedHoursAgo - 1,
    );
    pushHistory(
      seed.id,
      "EVIDENCE_UNDER_REVIEW",
      "UNDER_REVIEW",
      "OFFICER",
      2,
      acceptedHoursAgo,
    );
    pushHistory(
      seed.id,
      "UNDER_REVIEW",
      "IN_PROGRESS",
      "OFFICER",
      2,
      seed.closedHoursAgo + 20,
    );
    pushHistory(
      seed.id,
      "IN_PROGRESS",
      "UNDER_RESOLUTION",
      "OFFICER",
      2,
      seed.closedHoursAgo + 10,
    );
    pushHistory(
      seed.id,
      "UNDER_RESOLUTION",
      "RESOLVED",
      "OFFICER",
      2,
      seed.closedHoursAgo + 6,
    );
    pushHistory(seed.id, "RESOLVED", "CLOSED", "CITIZEN", 5, seed.closedHoursAgo);

    if (seed.id === 120) {
      pushPoints(5, seed.id, 10, "FIRST_COMPLAINT", seed.submittedHoursAgo);
    }
    pushPoints(5, seed.id, 50, "COMPLAINT_CLOSED", seed.closedHoursAgo);
    if (seed.onTimeBonus) {
      pushPoints(5, seed.id, 15, "ON_TIME_BONUS", seed.closedHoursAgo);
    }
  }

  // Badges Aditi (citizenId 5) has earned given the ledger above.
  citizenBadges.push(
    { id: citizenBadgeId++, citizenId: 5, badgeId: 1, earnedAt: iso(24 * 25) }, // KARTAVYA_INITIATE
    { id: citizenBadgeId++, citizenId: 5, badgeId: 2, earnedAt: iso(24 * 1) }, // STREET_GUARDIAN
    { id: citizenBadgeId++, citizenId: 5, badgeId: 3, earnedAt: iso(24 * 1) }, // ZONE_CHAMPION
    { id: citizenBadgeId++, citizenId: 5, badgeId: 4, earnedAt: iso(24 * 4) }, // CENTURY_REFORMER
    { id: citizenBadgeId++, citizenId: 5, badgeId: 6, earnedAt: iso(24 * 1) }, // SWIFT_REPORTER
  );

  const clusters: ClusterRow[] = [cluster1];

  return {
    users,
    zones,
    categories,
    clusters,
    complaints,
    evidence,
    statusHistory,
    notes,
    upvotes,
    pointsLedger,
    badges,
    citizenBadges,
    aiZoneReports: [],
    appSettings: {
      id: 1,
      autoCloseTimeoutHours: 168,
      updatedBy: null,
      updatedAt: iso(24 * 365),
    },
    nextId: {
      users: 12,
      zones: 4,
      categories: 12,
      clusters: 1,
      complaints: 124,
      evidence: evidenceId - 1,
      statusHistory: historyId - 1,
      notes: noteId - 1,
      upvotes: upvoteId - 1,
      pointsLedger: pointsId - 1,
      citizenBadges: citizenBadgeId - 1,
      aiZoneReports: 0,
    },
  };
}
