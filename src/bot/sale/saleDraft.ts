import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import type { BrandDiscounts, WpBrand } from '../../services/wpBrandSaleClient.js';
import { isValidPercent } from './saleLogic.js';

export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const WIZARD_BRANDS_PER_PAGE = 20;

// ==========================================
// DRAFT SCHEMA & TYPES
// ==========================================

export const draftGroupSchema = z.object({
  pct: z.number().int().min(1).max(90),
  brandIds: z.array(z.string()),
});

export type DraftGroup = z.infer<typeof draftGroupSchema>;

export const draftStepSchema = z.enum([
  'pick_pct', // Step 1: choose discount % (25/30/35/40/45/50 or custom)
  'await_custom_pct', // Step 1b: waiting for typed 1..90
  'pick_brands', // Step 2: toggle brands for currentPct (20 per page, 2 cols)
  'ask_more_groups', // Step 3: "Add another group?" Yes / No
  'await_start_date', // Step 4a: "Now" button or typed dd.mm.yyyy (00:00 Madrid)
  'await_end_date', // Step 4b: typed dd.mm.yyyy (23:59:59 Madrid)
  'confirm', // Step 5: summary & Confirm / Cancel
  'confirm_replace', // Step 6b: separate warning screen when a sale is currently running
]);

export type DraftStep = z.infer<typeof draftStepSchema>;

export const saleDraftDataSchema = z.object({
  step: draftStepSchema,
  /** Completed percentage groups */
  groups: z.array(draftGroupSchema),
  /** Known brand names at the time of selection (so dropped brands can be named) */
  brandNames: z.record(z.string()).default({}),
  /** Currently active percentage being edited in step 'pick_brands' */
  currentPct: z.number().int().min(1).max(90).optional(),
  /** Brand IDs selected in the current group being edited */
  currentBrandIds: z.array(z.string()).default([]),
  /** Current pagination page (1-based) in 'pick_brands' */
  page: z.number().int().min(1).default(1),
  /** Explicit start timestamp (unix seconds); undefined when `startNow` is true */
  startUnix: z.number().int().positive().optional(),
  /**
   * True when the user chose "Now" as the start date.
   * The actual unix timestamp is resolved ONLY at "Confirm" time, never when clicking "Now".
   */
  startNow: z.boolean().default(false),
  /** Chosen end timestamp (unix seconds) */
  endUnix: z.number().int().positive().optional(),
  /** Message ID of the wizard message to edit in place */
  messageId: z.number().int().optional(),
  /** True only while the bot is actively waiting for a text message in chat */
  awaitingText: z.boolean().default(false),
});

export type SaleDraftData = z.infer<typeof saleDraftDataSchema>;

// ==========================================
// PURE DOMAIN LOGIC (UNIT-TESTED)
// ==========================================

export class DraftOverlapError extends Error {
  brandId: string;
  existingPct: number;
  constructor(brandId: string, existingPct: number) {
    super(`Brand ${brandId} is already assigned to ${existingPct}%`);
    this.name = 'DraftOverlapError';
    this.brandId = brandId;
    this.existingPct = existingPct;
  }
}

export function createInitialDraft(messageId?: number): SaleDraftData {
  return {
    step: 'pick_pct',
    groups: [],
    brandNames: {},
    currentBrandIds: [],
    page: 1,
    startNow: false,
    messageId,
    awaitingText: false,
  };
}

/** Checks whether a draft `updatedAt` timestamp is older than 24 hours. */
export function isDraftExpired(updatedAt: Date | number, nowMs = Date.now()): boolean {
  const ts = typeof updatedAt === 'number' ? updatedAt : updatedAt.getTime();
  return nowMs - ts > DRAFT_TTL_MS;
}

/**
 * Returns a map `brandId -> pct` for all brands locked in OTHER groups
 * (excludes `excludePct` if that group is currently being edited).
 */
export function getLockedBrandsMap(groups: DraftGroup[], excludePct?: number): Record<string, number> {
  const locked: Record<string, number> = {};
  for (const g of groups) {
    if (excludePct !== undefined && g.pct === excludePct) continue;
    for (const id of g.brandIds) {
      locked[String(id)] = g.pct;
    }
  }
  return locked;
}

/**
 * Starts editing a percentage group. If a group with `pct` already exists in `groups`,
 * loads its `brandIds` into `currentBrandIds` so the user can add/remove brands in it.
 */
export function startGroupSelection(draft: SaleDraftData, pct: number): SaleDraftData {
  if (!isValidPercent(pct)) {
    throw new Error(`Invalid percent: ${pct}`);
  }
  const existing = draft.groups.find((g) => g.pct === pct);
  return {
    ...draft,
    step: 'pick_brands',
    currentPct: pct,
    currentBrandIds: existing ? [...existing.brandIds] : [],
    page: 1,
    awaitingText: false,
  };
}

/**
 * Toggles a brand in `currentBrandIds`.
 * Throws `DraftOverlapError` if the brand is already locked in another percentage group
 * (never silently overwrites).
 */
export function toggleDraftBrand(
  draft: SaleDraftData,
  brandId: string,
  brandName?: string
): { draft: SaleDraftData; added: boolean } {
  const id = String(brandId);
  const locked = getLockedBrandsMap(draft.groups, draft.currentPct);
  if (locked[id] !== undefined) {
    throw new DraftOverlapError(id, locked[id]);
  }
  const set = new Set(draft.currentBrandIds.map(String));
  let added: boolean;
  if (set.has(id)) {
    set.delete(id);
    added = false;
  } else {
    set.add(id);
    added = true;
  }
  const nextNames = { ...draft.brandNames };
  if (brandName) nextNames[id] = brandName;
  return {
    draft: {
      ...draft,
      brandNames: nextNames,
      currentBrandIds: [...set],
    },
    added,
  };
}

/**
 * Commits `currentPct` and `currentBrandIds` into `groups` and moves to `ask_more_groups`.
 * Returns `null` if no brands are selected in the current group.
 */
export function commitCurrentGroup(draft: SaleDraftData): SaleDraftData | null {
  const pct = draft.currentPct;
  if (!pct || draft.currentBrandIds.length === 0) return null;

  const locked = getLockedBrandsMap(draft.groups, pct);
  for (const id of draft.currentBrandIds) {
    if (locked[id] !== undefined) {
      throw new DraftOverlapError(id, locked[id]);
    }
  }

  const uniqueIds = [...new Set(draft.currentBrandIds.map(String))];
  const otherGroups = draft.groups.filter((g) => g.pct !== pct);
  const nextGroups: DraftGroup[] = [...otherGroups, { pct, brandIds: uniqueIds }].sort(
    (a, b) => b.pct - a.pct
  );

  return {
    ...draft,
    step: 'ask_more_groups',
    groups: nextGroups,
    currentPct: undefined,
    currentBrandIds: [],
    page: 1,
    awaitingText: false,
  };
}

/**
 * Marks the draft start date as "Now" (`startNow = true`, `startUnix = undefined`)
 * and advances to `await_end_date`. The concrete unix timestamp is computed only at Confirm time.
 */
export function selectStartNowOnDraft(draft: SaleDraftData): SaleDraftData {
  return {
    ...draft,
    step: 'await_end_date',
    startNow: true,
    startUnix: undefined,
    awaitingText: true,
  };
}

/**
 * Resolves the effective start unix timestamp at confirmation time:
 * if `draft.startNow` is true, returns fresh `serverNowUnix`; otherwise returns `draft.startUnix`.
 */
export function resolveDraftStartUnix(draft: SaleDraftData, serverNowUnix: number): number {
  if (draft.startNow) return serverNowUnix;
  return draft.startUnix ?? serverNowUnix;
}

/**
 * Removes any brands from `draft.groups` and `draft.currentBrandIds` that no longer exist
 * in `availableBrands` (e.g. deleted in WordPress while the draft was saved).
 * Returns the cleaned draft and the list of removed `{ id, name }` entries.
 */
export function pruneMissingBrandsFromDraft(
  draft: SaleDraftData,
  availableBrands: WpBrand[]
): { draft: SaleDraftData; removed: Array<{ id: string; name: string }> } {
  const validIds = new Set(availableBrands.map((b) => String(b.id)));
  const liveNames: Record<string, string> = { ...draft.brandNames };
  for (const b of availableBrands) {
    liveNames[String(b.id)] = b.name;
  }

  const removedMap = new Map<string, string>();
  const recordRemoved = (id: string) => {
    const key = String(id);
    if (!removedMap.has(key)) {
      removedMap.set(key, draft.brandNames[key] ?? `#${key}`);
    }
  };

  const nextGroups: DraftGroup[] = [];
  for (const g of draft.groups) {
    const kept: string[] = [];
    for (const id of g.brandIds) {
      if (validIds.has(String(id))) {
        kept.push(String(id));
      } else {
        recordRemoved(String(id));
      }
    }
    if (kept.length > 0) {
      nextGroups.push({ pct: g.pct, brandIds: kept });
    }
  }

  const nextCurrentBrandIds: string[] = [];
  for (const id of draft.currentBrandIds) {
    if (validIds.has(String(id))) {
      nextCurrentBrandIds.push(String(id));
    } else {
      recordRemoved(String(id));
    }
  }

  let nextStep = draft.step;
  let nextAwaitingText = draft.awaitingText;
  if (
    nextGroups.length === 0 &&
    (draft.step === 'ask_more_groups' ||
      draft.step === 'await_start_date' ||
      draft.step === 'await_end_date' ||
      draft.step === 'confirm' ||
      draft.step === 'confirm_replace')
  ) {
    nextStep = 'pick_pct';
    nextAwaitingText = false;
  }

  const removed = [...removedMap.entries()].map(([id, name]) => ({ id, name }));
  return {
    draft: {
      ...draft,
      step: nextStep,
      groups: nextGroups,
      brandNames: liveNames,
      currentBrandIds: nextCurrentBrandIds,
      awaitingText: nextAwaitingText,
    },
    removed,
  };
}

/**
 * Builds the final `{ "<term_id>": pct }` map from `groups`.
 * Throws `DraftOverlapError` if any brand appears in more than one group,
 * or Error if the result is empty or contains an invalid percentage.
 */
export function buildDiscountsFromGroups(groups: DraftGroup[]): BrandDiscounts {
  const out: BrandDiscounts = {};
  for (const g of groups) {
    if (!isValidPercent(g.pct)) {
      throw new Error(`Invalid group percentage: ${g.pct}`);
    }
    for (const rawId of g.brandIds) {
      const id = String(rawId);
      if (out[id] !== undefined && out[id] !== g.pct) {
        throw new DraftOverlapError(id, out[id]);
      }
      out[id] = g.pct;
    }
  }
  if (Object.keys(out).length === 0) {
    throw new Error('At least one brand must be selected');
  }
  return out;
}

// ==========================================
// PERSISTENCE (PRISMA + IN-MEMORY FOR TESTS)
// ==========================================

export interface SaleDraftStore {
  get(telegramId: bigint | number | string, nowMs?: number): Promise<SaleDraftData | null>;
  save(telegramId: bigint | number | string, data: SaleDraftData): Promise<SaleDraftData>;
  clear(telegramId: bigint | number | string): Promise<void>;
}

export const prismaSaleDraftStore: SaleDraftStore = {
  async get(telegramId, nowMs = Date.now()) {
    const id = BigInt(telegramId);
    const row = await prisma.saleDraft.findUnique({ where: { telegramId: id } });
    if (!row) return null;
    if (isDraftExpired(row.updatedAt, nowMs)) {
      await prisma.saleDraft.deleteMany({ where: { telegramId: id } });
      return null;
    }
    const parsed = saleDraftDataSchema.safeParse(row.data);
    if (!parsed.success) {
      await prisma.saleDraft.deleteMany({ where: { telegramId: id } });
      return null;
    }
    return parsed.data;
  },

  async save(telegramId, data) {
    const id = BigInt(telegramId);
    const validated = saleDraftDataSchema.parse(data);
    await prisma.saleDraft.upsert({
      where: { telegramId: id },
      update: { data: validated },
      create: { telegramId: id, data: validated },
    });
    return validated;
  },

  async clear(telegramId) {
    const id = BigInt(telegramId);
    await prisma.saleDraft.deleteMany({ where: { telegramId: id } });
  },
};

/** In-memory store with the exact same semantics (including 24h TTL) for unit tests. */
export function createMemorySaleDraftStore(): SaleDraftStore & {
  setUpdatedAt(telegramId: bigint | number | string, updatedAtMs: number): void;
} {
  const map = new Map<string, { data: SaleDraftData; updatedAt: number }>();
  return {
    async get(telegramId, nowMs = Date.now()) {
      const key = String(telegramId);
      const entry = map.get(key);
      if (!entry) return null;
      if (isDraftExpired(entry.updatedAt, nowMs)) {
        map.delete(key);
        return null;
      }
      return structuredClone(entry.data);
    },
    async save(telegramId, data) {
      const validated = saleDraftDataSchema.parse(data);
      map.set(String(telegramId), { data: structuredClone(validated), updatedAt: Date.now() });
      return validated;
    },
    async clear(telegramId) {
      map.delete(String(telegramId));
    },
    setUpdatedAt(telegramId, updatedAtMs) {
      const key = String(telegramId);
      const entry = map.get(key);
      if (entry) entry.updatedAt = updatedAtMs;
    },
  };
}
