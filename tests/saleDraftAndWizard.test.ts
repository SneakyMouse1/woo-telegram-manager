import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDiscountsFromGroups,
  commitCurrentGroup,
  createInitialDraft,
  createMemorySaleDraftStore,
  DRAFT_TTL_MS,
  DraftOverlapError,
  getLockedBrandsMap,
  isDraftExpired,
  pruneMissingBrandsFromDraft,
  resolveDraftStartUnix,
  selectStartNowOnDraft,
  startGroupSelection,
  toggleDraftBrand,
  WIZARD_BRANDS_PER_PAGE,
} from '../src/bot/sale/saleDraft.js';
import {
  formatWpError,
  renderCurrentSale,
  renderWizardConfirm,
  renderWizardPickBrands,
  renderWizardReplaceWarning,
  type SaleStoreViewCtx,
} from '../src/bot/sale/saleFormatter.js';
import {
  applySaleInputResetMiddleware,
  executeWizardConfirm,
  handleSaleTextInput,
  registerSaleHandlers,
} from '../src/bot/sale/saleHandlers.js';
import { withBrandPercent } from '../src/bot/sale/saleLogic.js';
import {
  ENV_STORE_SLUG,
  SaleAccessError,
  type SaleStoreResolver,
} from '../src/services/wpBrandSale.js';
import { WpBrandSaleError, type BrandSale, type WpBrand } from '../src/services/wpBrandSaleClient.js';

const STORE_A: SaleStoreViewCtx = { slug: 'shop-a', name: 'shop-a' };
const STORE_B: SaleStoreViewCtx = { slug: 'shop-b', name: 'shop-b' };

const SAMPLE_BRANDS: WpBrand[] = [
  { id: 665, name: 'Alpha', taxonomy: 'product_brand', count: 10 },
  { id: 661, name: 'Beta', taxonomy: 'product_brand', count: 8 },
  { id: 700, name: 'Gamma', taxonomy: 'product_brand', count: 4 },
];

function createMockCtx(chatId: number, fromId = chatId, messageId = 100) {
  const edits: string[] = [];
  const replies: Array<{ text: string; reply_markup?: any }> = [];
  const callbacks: Array<{ text?: string; show_alert?: boolean }> = [];
  const ctx: any = {
    chat: { id: chatId },
    from: { id: fromId, language_code: 'ru' },
    match: '',
    callbackQuery: {
      data: 's:ncf:shop-a',
      message: { message_id: messageId },
    },
    api: {
      editMessageText: async (_c: any, _m: any, text: string) => {
        edits.push(text);
      },
      deleteMessage: async () => {},
    },
    reply: async (text: string, opts?: any) => {
      replies.push({ text, reply_markup: opts?.reply_markup });
    },
    answerCallbackQuery: async (opts?: any) => {
      callbacks.push(opts ?? {});
    },
    deleteMessage: async () => {},
  };
  return { ctx, edits, replies, callbacks };
}

test('buildDiscountsFromGroups assembles final discounts map from multiple groups', () => {
  const discounts = buildDiscountsFromGroups([
    { pct: 50, brandIds: ['665', '661'] },
    { pct: 30, brandIds: ['700'] },
  ]);
  assert.deepEqual(discounts, {
    '665': 50,
    '661': 50,
    '700': 30,
  });
});

test('buildDiscountsFromGroups and toggleDraftBrand forbid brand overlap across groups', () => {
  assert.throws(
    () =>
      buildDiscountsFromGroups([
        { pct: 50, brandIds: ['665', '661'] },
        { pct: 30, brandIds: ['661', '700'] },
      ]),
    (err: any) =>
      err instanceof DraftOverlapError && err.brandId === '661' && err.existingPct === 50
  );

  let draft = createInitialDraft();
  draft = startGroupSelection(draft, 50);
  draft = toggleDraftBrand(draft, '665', 'Alpha').draft;
  draft = toggleDraftBrand(draft, '661', 'Beta').draft;
  const afterGroup1 = commitCurrentGroup(draft);
  assert.ok(afterGroup1);
  assert.equal(afterGroup1.step, 'ask_more_groups');

  const group2 = startGroupSelection(afterGroup1, 30);
  assert.deepEqual(getLockedBrandsMap(group2.groups, 30), { '665': 50, '661': 50 });

  assert.throws(
    () => toggleDraftBrand(group2, '665', 'Alpha'),
    (err: any) =>
      err instanceof DraftOverlapError && err.brandId === '665' && err.existingPct === 50
  );

  const group2With700 = toggleDraftBrand(group2, '700', 'Gamma').draft;
  const afterGroup2 = commitCurrentGroup(group2With700);
  assert.ok(afterGroup2);
  assert.deepEqual(buildDiscountsFromGroups(afterGroup2.groups), {
    '665': 50,
    '661': 50,
    '700': 30,
  });
});

test('renderWizardPickBrands paginates 20 brands per page in 2 columns, marks ✅ and 🔒, and keeps callback_data <= 64 bytes', () => {
  const brands: WpBrand[] = Array.from({ length: 25 }, (_, i) => ({
    id: 600 + i,
    name: `Brand ${i + 1}`,
    taxonomy: 'product_brand',
    count: 5,
  }));

  let draft = createInitialDraft();
  draft = {
    ...draft,
    step: 'pick_brands',
    groups: [{ pct: 50, brandIds: ['600'] }],
    currentPct: 30,
    currentBrandIds: ['601'],
    page: 1,
  };

  assert.equal(WIZARD_BRANDS_PER_PAGE, 20);
  const maxStore: SaleStoreViewCtx = { slug: '1234567890123456', name: '1234567890123456' };
  const view1 = renderWizardPickBrands(draft, brands, maxStore, 'ru');
  const rows1 = view1.reply_markup.inline_keyboard;

  assert.equal(rows1.length, 13);
  assert.equal(rows1[0].length, 2);
  assert.match(rows1[0][0].text, /🔒.*50%/);
  assert.match(rows1[0][1].text, /^✅ /);

  const view2 = renderWizardPickBrands({ ...draft, page: 2 }, brands, maxStore, 'ru');
  const rows2 = view2.reply_markup.inline_keyboard;
  assert.equal(rows2.length, 3 + 1 + 1 + 1);

  for (const row of [...rows1, ...rows2]) {
    for (const btn of row) {
      if ('callback_data' in btn && btn.callback_data) {
        assert.ok(Buffer.byteLength(btn.callback_data, 'utf8') <= 64);
      }
    }
  }
});

test('All multi-store sale callbacks stay <= 64 bytes under worst-case parameters', () => {
  const maxSlug = '1234567890123456'; // 16 chars max store slug
  const maxBrandId = '99999999'; // 8 digits
  const maxUnix = '1999999999'; // 10 digits
  const maxPage = '999';

  const samples = [
    's:stores',
    `s:m:${maxSlug}`,
    `s:cur:${maxSlug}`,
    `s:eb:${maxSlug}:${maxPage}`,
    `s:ebs:${maxSlug}:${maxBrandId}`,
    `s:ebp:${maxSlug}:${maxBrandId}:90`,
    `s:ebc:${maxSlug}:${maxBrandId}`,
    `s:ebr:${maxSlug}:${maxBrandId}`,
    `s:ed:${maxSlug}`,
    `s:eds:${maxSlug}:now`,
    `s:eds:${maxSlug}:keep`,
    `s:ede:${maxSlug}:keep:${maxUnix}`,
    `s:end:ask:${maxSlug}`,
    `s:end:do:${maxSlug}`,
    `s:new:${maxSlug}`,
    `s:nrs:${maxSlug}`,
    `s:npk:${maxSlug}`,
    `s:npct:${maxSlug}:90`,
    `s:npc:${maxSlug}`,
    `s:t:${maxSlug}:${maxBrandId}`,
    `s:np:${maxSlug}:${maxPage}`,
    `s:nd:${maxSlug}`,
    `s:na:${maxSlug}:y`,
    `s:na:${maxSlug}:n`,
    `s:nb:grp:${maxSlug}`,
    `s:ns:now:${maxSlug}`,
    `s:ncf:${maxSlug}`,
    `s:nrp:${maxSlug}`,
    `s:nx:${maxSlug}`,
  ];

  for (const cb of samples) {
    const bytes = Buffer.byteLength(cb, 'utf8');
    assert.ok(bytes <= 64, `callback "${cb}" is ${bytes} bytes (> 64)`);
  }
});

test('SaleDraft store isolates drafts per (telegramId, storeKey), ignores drafts older than 24h, and clears per store', async () => {
  const store = createMemorySaleDraftStore();
  const userId = 900001n;

  const d1 = await store.save(userId, STORE_A.slug, createInitialDraft(100));
  assert.equal((await store.get(userId, STORE_A.slug))?.step, 'pick_pct');
  assert.equal(await store.get(userId, STORE_B.slug), null);

  // Separate draft on STORE_B does not overwrite STORE_A
  const dB = await store.save(
    userId,
    STORE_B.slug,
    toggleDraftBrand(startGroupSelection(createInitialDraft(200), 30), '700', 'Gamma').draft
  );
  assert.deepEqual((await store.get(userId, STORE_B.slug))?.currentBrandIds, ['700']);
  assert.equal((await store.get(userId, STORE_A.slug))?.step, 'pick_pct');

  const d2 = await store.save(
    userId,
    STORE_A.slug,
    toggleDraftBrand(startGroupSelection(d1, 50), '665', 'Alpha').draft
  );
  assert.deepEqual((await store.get(userId, STORE_A.slug))?.currentBrandIds, ['665']);

  const d3 = await store.save(userId, STORE_A.slug, commitCurrentGroup(d2)!);
  assert.equal((await store.get(userId, STORE_A.slug))?.step, 'ask_more_groups');

  const t0 = 1_700_000_000_000;
  store.setUpdatedAt(userId, STORE_A.slug, t0);
  assert.equal(isDraftExpired(t0, t0 + DRAFT_TTL_MS), false);
  assert.ok(await store.get(userId, STORE_A.slug, t0 + DRAFT_TTL_MS));

  assert.equal(isDraftExpired(t0, t0 + DRAFT_TTL_MS + 1), true);
  assert.equal(await store.get(userId, STORE_A.slug, t0 + DRAFT_TTL_MS + 1), null);

  // Clearing STORE_A leaves STORE_B intact
  await store.save(userId, STORE_A.slug, d3);
  await store.clear(userId, STORE_A.slug);
  assert.equal(await store.get(userId, STORE_A.slug), null);
  assert.deepEqual((await store.get(userId, STORE_B.slug))?.currentBrandIds, dB.currentBrandIds);
});

test('wizard text input: exiting via slash command or callback stops intercepting plain text for any user', async () => {
  const store = createMemorySaleDraftStore();
  const managerChatId = 555555;

  await store.save(managerChatId, STORE_A.slug, {
    ...createInitialDraft(55),
    step: 'await_custom_pct',
    awaitingText: true,
  });

  await applySaleInputResetMiddleware(
    {
      chat: { id: managerChatId } as any,
      from: { id: managerChatId } as any,
      message: { text: '/orders' } as any,
      callbackQuery: undefined,
    },
    store
  );

  const afterCmd = await store.get(managerChatId, STORE_A.slug);
  assert.equal(afterCmd?.awaitingText, false);

  const dummyResolver: SaleStoreResolver = {
    isAdmin: () => false,
    getAccessibleSaleStores: async () => [],
    hasAnyAccessibleStore: async () => true,
    resolveSaleStore: async () => {
      throw new Error('should not be called when no draft is awaiting text');
    },
  };

  const consumed = await handleSaleTextInput(
    {
      from: { id: managerChatId },
      chat: { id: managerChatId },
      message: { text: 'crema hidratante' },
    } as any,
    dummyResolver,
    store
  );
  assert.equal(consumed, false);
});

test('confirm and replace-warning screens render store name, dates, brand groups and store-scoped buttons', () => {
  const draft = {
    ...createInitialDraft(77),
    step: 'confirm' as const,
    groups: [
      { pct: 50, brandIds: ['665'] },
      { pct: 30, brandIds: ['661'] },
    ],
    startUnix: 1793000000,
    endUnix: 1793600000,
  };
  const names = { '665': 'Alpha', '661': 'Beta' };

  const confirmView = renderWizardConfirm(draft, names, STORE_A, 'ru');
  assert.match(confirmView.text, /shop-a/);
  assert.match(confirmView.text, /Alpha → <b>−50%<\/b>/);
  assert.match(confirmView.text, /Beta → <b>−30%<\/b>/);
  const confirmBtn = confirmView.reply_markup.inline_keyboard[0][0];
  assert.equal('callback_data' in confirmBtn ? confirmBtn.callback_data : undefined, 's:ncf:shop-a');

  const replaceView = renderWizardReplaceWarning({ ...draft, step: 'confirm_replace' }, names, STORE_A, 'ru');
  assert.match(replaceView.text, /полностью заменена/);
  const replaceBtn = replaceView.reply_markup.inline_keyboard[0][0];
  assert.equal('callback_data' in replaceBtn ? replaceBtn.callback_data : undefined, 's:nrp:shop-a');
});

// ==========================================
// FIX 1: startNow=true is resolved at Confirm time, not when clicking "Now"
// ==========================================

test('startNow=true does not freeze unix timestamp on click; resolves fresh now at Confirm time (e.g. next day)', async () => {
  const store = createMemorySaleDraftStore();
  const chatId = 900001;

  // Day 1: user clicks "Now"
  let draft = createInitialDraft(100);
  draft = {
    ...draft,
    groups: [{ pct: 50, brandIds: ['665'] }],
    brandNames: { '665': 'Alpha' },
  };
  const afterNowClick = selectStartNowOnDraft(draft);
  assert.equal(afterNowClick.startNow, true);
  assert.equal(afterNowClick.startUnix, undefined);

  // User enters an end date 5 days ahead and reaches 'confirm'
  const day1Now = 1_790_000_000;
  const nextDayNow = day1Now + 86_400; // +24 hours later when clicking Confirm
  const endUnix = day1Now + 5 * 86_400;

  await store.save(chatId, STORE_A.slug, {
    ...afterNowClick,
    step: 'confirm',
    endUnix,
    awaitingText: false,
  });

  // Verify resolveDraftStartUnix uses the fresh server timestamp
  assert.equal(resolveDraftStartUnix(afterNowClick, day1Now), day1Now);
  assert.equal(resolveDraftStartUnix(afterNowClick, nextDayNow), nextDayNow);

  let savedPayload: any = null;
  const mockClient = {
    getBrands: async () => SAMPLE_BRANDS,
    getSale: async (): Promise<BrandSale> => ({
      version: '1',
      start: null,
      end: null,
      active: false,
      now: nextDayNow,
      discounts: {},
      brands: {},
    }),
    saveSale: async (cfg: any): Promise<BrandSale> => {
      savedPayload = cfg;
      return {
        version: '2',
        start: cfg.start,
        end: cfg.end,
        active: true,
        now: nextDayNow,
        discounts: cfg.discounts,
        brands: { '665': { name: 'Alpha', discount: 50 } },
      };
    },
  };

  const { ctx } = createMockCtx(chatId);
  await executeWizardConfirm(ctx, 'initial', { ...STORE_A, client: mockClient }, 'ru', store);

  assert.ok(savedPayload, 'saveSale should have been called');
  assert.equal(savedPayload.start, nextDayNow, 'start must be nextDayNow, not yesterday');
  assert.equal(savedPayload.end, endUnix);
  assert.equal(await store.get(chatId, STORE_A.slug), null, 'draft must be cleared after save');
});

// ==========================================
// FIX 2: Confirm re-validates end > now & end > start and returns to await_end_date
// ==========================================

test('executeWizardConfirm re-checks end > now and end > start before saveSale() and returns to end-date step if expired', async () => {
  const store = createMemorySaleDraftStore();
  const chatId = 900001;

  // Draft has endUnix = 2000, but by the time user clicks Confirm, server now is 2500
  await store.save(chatId, STORE_A.slug, {
    ...createInitialDraft(100),
    step: 'confirm',
    groups: [{ pct: 50, brandIds: ['665'] }],
    brandNames: { '665': 'Alpha' },
    startUnix: 1500,
    startNow: false,
    endUnix: 2000,
    awaitingText: false,
  });

  let saveCalled = false;
  const mockClient = {
    getBrands: async () => SAMPLE_BRANDS,
    getSale: async (): Promise<BrandSale> => ({
      version: '1',
      start: null,
      end: null,
      active: false,
      now: 2500, // now > endUnix!
      discounts: {},
      brands: {},
    }),
    saveSale: async (): Promise<BrandSale> => {
      saveCalled = true;
      throw new Error('should not be called');
    },
  };

  const { ctx, edits } = createMockCtx(chatId);
  await executeWizardConfirm(ctx, 'initial', { ...STORE_A, client: mockClient }, 'ru', store);

  assert.equal(saveCalled, false, 'saveSale must NOT be called when end <= now');
  const updatedDraft = await store.get(chatId, STORE_A.slug);
  assert.ok(updatedDraft);
  assert.equal(updatedDraft.step, 'await_end_date', 'must return user to await_end_date step');
  assert.equal(updatedDraft.endUnix, undefined);
  assert.equal(updatedDraft.awaitingText, true);
  assert.ok(edits.length > 0);
  assert.match(edits[0], /Конец акции должен быть в будущем/);
  assert.match(edits[0], /Дата окончания акции/);
});

// ==========================================
// FIX 3: Prune deleted brands from draft & show which brands were dropped
// ==========================================

test('pruneMissingBrandsFromDraft removes deleted brands, drops empty groups, and reports dropped brand names', async () => {
  const store = createMemorySaleDraftStore();
  const chatId = 900001;

  // Draft had Alpha (665) in 50% and DeletedBrand (999) in 30%
  const draft = {
    ...createInitialDraft(100),
    step: 'confirm' as const,
    groups: [
      { pct: 50, brandIds: ['665'] },
      { pct: 30, brandIds: ['999'] },
    ],
    brandNames: { '665': 'Alpha', '999': 'DeletedCosmetics' },
    startNow: true,
    endUnix: 2_000_000_000,
  };

  const pruned = pruneMissingBrandsFromDraft(draft, SAMPLE_BRANDS);
  assert.deepEqual(pruned.removed, [{ id: '999', name: 'DeletedCosmetics' }]);
  assert.deepEqual(pruned.draft.groups, [{ pct: 50, brandIds: ['665'] }]);
  assert.equal(pruned.draft.step, 'confirm');

  // If ALL brands in the draft were deleted on the site, step resets to 'pick_pct'
  const allGone = pruneMissingBrandsFromDraft(
    {
      ...draft,
      groups: [{ pct: 30, brandIds: ['999'] }],
    },
    SAMPLE_BRANDS
  );
  assert.equal(allGone.draft.groups.length, 0);
  assert.equal(allGone.draft.step, 'pick_pct');

  // Verify executeWizardConfirm stops to show dropped brands instead of saving silently
  await store.save(chatId, STORE_A.slug, draft);
  let saveCalled = false;
  const mockClient = {
    getBrands: async () => SAMPLE_BRANDS,
    getSale: async (): Promise<BrandSale> => ({
      version: '1',
      start: null,
      end: null,
      active: false,
      now: 1_790_000_000,
      discounts: {},
      brands: {},
    }),
    saveSale: async (): Promise<BrandSale> => {
      saveCalled = true;
      throw new Error('should not save before user sees dropped brands');
    },
  };

  const { ctx, edits } = createMockCtx(chatId);
  await executeWizardConfirm(ctx, 'initial', { ...STORE_A, client: mockClient }, 'ru', store);
  assert.equal(saveCalled, false);
  assert.match(edits[0], /DeletedCosmetics/);
  const savedAfterPrune = await store.get(chatId, STORE_A.slug);
  assert.deepEqual(savedAfterPrune?.groups, [{ pct: 50, brandIds: ['665'] }]);
});

// ==========================================
// E2E scenario, Multi-Store Access Control, Error formatting
// ==========================================

test('Checklist scenario: 2 groups -> confirm -> Current sale shows same -> change 1 brand % -> end sale', async () => {
  const store = createMemorySaleDraftStore();
  const chatId = 555555; // Store manager!
  const nowUnix = 1_790_000_000;
  const endUnix = 1_795_000_000;

  // Build 2 groups in draft: 50% (Alpha 665) and 30% (Beta 661)
  let d = createInitialDraft(100);
  d = startGroupSelection(d, 50);
  d = toggleDraftBrand(d, '665', 'Alpha').draft;
  d = commitCurrentGroup(d)!;
  d = startGroupSelection(d, 30);
  d = toggleDraftBrand(d, '661', 'Beta').draft;
  d = commitCurrentGroup(d)!;
  d = selectStartNowOnDraft(d);
  d = { ...d, step: 'confirm', endUnix };
  await store.save(chatId, STORE_A.slug, d);

  let state: BrandSale = {
    version: '1',
    start: null,
    end: null,
    active: false,
    now: nowUnix,
    discounts: {},
    brands: {},
  };

  const client = {
    getBrands: async () => SAMPLE_BRANDS,
    getSale: async () => structuredClone(state),
    saveSale: async (cfg: any) => {
      state = {
        version: String(Number(state.version) + 1),
        start: cfg.start,
        end: cfg.end,
        active: true,
        now: nowUnix,
        discounts: { ...cfg.discounts },
        brands: Object.fromEntries(
          Object.entries(cfg.discounts).map(([id, pct]) => [
            id,
            {
              name: SAMPLE_BRANDS.find((b) => String(b.id) === id)?.name ?? `#${id}`,
              discount: Number(pct),
            },
          ])
        ),
      };
      return structuredClone(state);
    },
    endSale: async () => {
      state = { ...state, version: String(Number(state.version) + 1), active: false, end: nowUnix };
      return structuredClone(state);
    },
  };

  // 1. Confirm new sale
  const { ctx } = createMockCtx(chatId);
  await executeWizardConfirm(ctx, 'initial', { ...STORE_A, client }, 'ru', store);
  assert.equal(state.version, '2');
  assert.deepEqual(state.discounts, { '665': 50, '661': 30 });

  // 2. "Current sale" renders the exact same groups and status
  const curView1 = renderCurrentSale(await client.getSale(), {}, STORE_A, 'ru');
  assert.match(curView1.text, /shop-a/);
  assert.match(curView1.text, /🟢 Идёт/);
  assert.match(curView1.text, /Alpha: <b>−50%<\/b>/);
  assert.match(curView1.text, /Beta: <b>−30%<\/b>/);

  // 3. Change Beta (661) discount from 30% to 40% (fresh getSale -> withBrandPercent -> saveSale)
  const freshBeforeEdit = await client.getSale();
  const updatedAfterEdit = await client.saveSale(withBrandPercent(freshBeforeEdit, '661', 40));
  assert.equal(updatedAfterEdit.version, '3');
  assert.deepEqual(updatedAfterEdit.discounts, { '665': 50, '661': 40 });

  // 4. End sale now
  const ended = await client.endSale();
  assert.equal(ended.active, false);
  const curViewAfterEnd = renderCurrentSale(ended, {}, STORE_A, 'ru');
  assert.match(curViewAfterEnd.text, /🔴 Закончилась/);
});

test('Multi-store access control: manager A can manage shop-a, cannot touch shop-b or __env__, multi-store user gets picker', async () => {
  const ADMIN_ID = 900001;
  const MANAGER_A_ID = 100001; // attached only to shop-a
  const MANAGER_AB_ID = 200002; // attached to shop-a & shop-b
  const MANAGER_C_ID = 300003; // attached to shop-c (no discounts configured)

  const commands = new Map<string, (ctx: any) => Promise<void>>();
  const callbacks: Array<{ pattern: string | RegExp; fn: (ctx: any) => Promise<void> }> = [];

  const fakeBot: any = {
    use: () => {},
    command: (name: string, fn: any) => commands.set(name, fn),
    callbackQuery: (pattern: string | RegExp, fn: any) => callbacks.push({ pattern, fn }),
  };

  let storeAApiCalls = 0;
  let storeBApiCalls = 0;
  let envApiCalls = 0;

  const makeMockClient = (onTouch: () => void): any => ({
    getBrands: async () => {
      onTouch();
      return SAMPLE_BRANDS;
    },
    getSale: async (): Promise<BrandSale> => {
      onTouch();
      return {
        version: '1',
        start: 1790000000,
        end: 1795000000,
        active: true,
        now: 1791000000,
        discounts: { '665': 50 },
        brands: { '665': { name: 'Alpha', discount: 50 } },
      };
    },
    saveSale: async (cfg: any) => {
      onTouch();
      return {
        version: '2',
        start: cfg.start,
        end: cfg.end,
        active: true,
        now: 1791000000,
        discounts: cfg.discounts,
        brands: { '665': { name: 'Alpha', discount: 50 } },
      };
    },
    endSale: async () => {
      onTouch();
      return {
        version: '2',
        start: 1790000000,
        end: 1791000000,
        active: false,
        now: 1791000000,
        discounts: { '665': 50 },
        brands: { '665': { name: 'Alpha', discount: 50 } },
      };
    },
    clearBrandsCache: () => {},
  });

  const clientA = makeMockClient(() => {
    storeAApiCalls++;
  });
  const clientB = makeMockClient(() => {
    storeBApiCalls++;
  });
  const clientEnv = makeMockClient(() => {
    envApiCalls++;
  });

  const storeAInfo = { id: 'uuid-a', slug: 'shop-a', name: 'shop-a', url: 'https://shop-a.test', source: 'store' as const };
  const storeBInfo = { id: 'uuid-b', slug: 'shop-b', name: 'shop-b', url: 'https://shop-b.test', source: 'store' as const };
  const envInfo = { id: ENV_STORE_SLUG, slug: ENV_STORE_SLUG, name: 'staging.test', url: 'https://staging.test', source: 'env' as const };

  const memberships: Record<number, string[]> = {
    [MANAGER_A_ID]: ['shop-a'],
    [MANAGER_AB_ID]: ['shop-a', 'shop-b'],
    [MANAGER_C_ID]: [],
  };

  const resolver: SaleStoreResolver = {
    isAdmin: (id) => Number(id) === ADMIN_ID,
    hasAnyAccessibleStore: async (id) => Number(id) !== 999999,
    getAccessibleSaleStores: async (id) => {
      if (Number(id) === ADMIN_ID) return [storeAInfo, storeBInfo, envInfo];
      const slugs = memberships[Number(id)] ?? [];
      return [storeAInfo, storeBInfo].filter((s) => slugs.includes(s.slug));
    },
    resolveSaleStore: async (id, storeIdentifier) => {
      const uid = Number(id);
      const slug = storeIdentifier.toLowerCase();
      if (slug === ENV_STORE_SLUG) {
        if (uid !== ADMIN_ID) throw new SaleAccessError('ACCESS_DENIED', 'Access denied');
        return { ...envInfo, client: clientEnv };
      }
      if (slug === 'shop-a') {
        if (uid !== ADMIN_ID && !(memberships[uid] ?? []).includes('shop-a')) {
          throw new SaleAccessError('ACCESS_DENIED', 'Access denied');
        }
        return { ...storeAInfo, client: clientA };
      }
      if (slug === 'shop-b') {
        if (uid !== ADMIN_ID && !(memberships[uid] ?? []).includes('shop-b')) {
          throw new SaleAccessError('ACCESS_DENIED', 'Access denied');
        }
        return { ...storeBInfo, client: clientB };
      }
      throw new SaleAccessError('STORE_NOT_FOUND', 'Store not found');
    },
  };

  registerSaleHandlers(fakeBot, resolver, createMemorySaleDraftStore());

  // 1. Manager A runs /discounts -> gets shop-a main menu directly
  {
    const { ctx, replies } = createMockCtx(MANAGER_A_ID);
    await commands.get('discounts')!(ctx);
    assert.equal(replies.length, 1);
    assert.match(replies[0].text, /shop-a/);
    assert.match(replies[0].text, /Скидки по брендам/);
  }

  // 2. Manager A clicks s:cur:shop-a -> succeeds and calls ONLY store A WP API
  {
    const entry = callbacks.find(({ pattern }) => typeof pattern !== 'string' && pattern.test('s:cur:shop-a'))!;
    const { ctx, edits } = createMockCtx(MANAGER_A_ID);
    ctx.callbackQuery.data = 's:cur:shop-a';
    ctx.match = 's:cur:shop-a'.match(entry.pattern as RegExp);
    await entry.fn(ctx);
    assert.equal(storeAApiCalls, 1);
    assert.equal(storeBApiCalls, 0);
    assert.equal(edits.length, 1);
    assert.match(edits[0], /shop-a/);
  }

  // 3. Manager A tries /discounts shop-b -> denied, store B WP API untouched
  {
    const { ctx, replies } = createMockCtx(MANAGER_A_ID);
    ctx.match = 'shop-b';
    await commands.get('discounts')!(ctx);
    assert.equal(replies.length, 1);
    assert.equal(replies[0].text, 'Access denied');
    assert.equal(storeBApiCalls, 0);
  }

  // 4. Manager A tries EVERY single s:* callback targeting shop-b -> denied, store B WP API NEVER touched
  const forbiddenStoreBCallbacks = [
    's:m:shop-b',
    's:cur:shop-b',
    's:eb:shop-b:1',
    's:ebs:shop-b:665',
    's:ebp:shop-b:665:40',
    's:ebc:shop-b:665',
    's:ebr:shop-b:665',
    's:ed:shop-b',
    's:eds:shop-b:now',
    's:ede:shop-b:keep:1790000000',
    's:end:ask:shop-b',
    's:end:do:shop-b',
    's:new:shop-b',
    's:nrs:shop-b',
    's:npk:shop-b',
    's:npct:shop-b:50',
    's:npc:shop-b',
    's:t:shop-b:665',
    's:np:shop-b:2',
    's:nd:shop-b',
    's:na:shop-b:y',
    's:nb:grp:shop-b',
    's:ns:now:shop-b',
    's:ncf:shop-b',
    's:nrp:shop-b',
    's:nx:shop-b',
  ];

  for (const data of forbiddenStoreBCallbacks) {
    const entry = callbacks.find(({ pattern }) =>
      typeof pattern === 'string' ? pattern === data : pattern.test(data)
    );
    assert.ok(entry, `handler must exist for ${data}`);
    const { ctx: cbCtx, replies, edits, callbacks: cbAnswers } = createMockCtx(MANAGER_A_ID);
    cbCtx.callbackQuery.data = data;
    cbCtx.match = typeof entry.pattern === 'string' ? [data] : data.match(entry.pattern);
    await entry.fn(cbCtx);
    assert.equal(replies.length, 0, `manager A must not get reply on ${data}`);
    assert.equal(edits.length, 0, `manager A must not get edit on ${data}`);
    assert.equal(cbAnswers[0]?.show_alert, true, `manager A must see access alert on ${data}`);
    assert.equal(storeBApiCalls, 0, `store B WP API must NOT be touched by manager A on ${data}`);
  }

  // 5. Manager A tries reserved __env__ fallback -> denied, env API untouched
  {
    const entry = callbacks.find(({ pattern }) => typeof pattern !== 'string' && pattern.test(`s:cur:${ENV_STORE_SLUG}`))!;
    const { ctx, edits, callbacks: cbAnswers } = createMockCtx(MANAGER_A_ID);
    ctx.callbackQuery.data = `s:cur:${ENV_STORE_SLUG}`;
    ctx.match = ctx.callbackQuery.data.match(entry.pattern as RegExp);
    await entry.fn(ctx);
    assert.equal(edits.length, 0);
    assert.equal(cbAnswers[0]?.show_alert, true);
    assert.equal(envApiCalls, 0);
  }

  // 6. Multi-store Manager AB runs /discounts -> gets store picker with shop-a and shop-b
  {
    const { ctx, replies } = createMockCtx(MANAGER_AB_ID);
    await commands.get('discounts')!(ctx);
    assert.equal(replies.length, 1);
    const kb = replies[0].reply_markup.inline_keyboard;
    assert.equal(kb.length, 2);
    assert.equal(kb[0][0].callback_data, 's:m:shop-a');
    assert.equal(kb[1][0].callback_data, 's:m:shop-b');
  }

  // 7. Manager C (store has no discounts configured) runs /discounts -> friendly non-admin message
  {
    const { ctx, replies } = createMockCtx(MANAGER_C_ID);
    await commands.get('discounts')!(ctx);
    assert.equal(replies.length, 1);
    assert.match(replies[0].text, /не настроены для ваших магазинов/);
  }

  // 8. Admin can access __env__ fallback
  {
    const entry = callbacks.find(({ pattern }) => typeof pattern !== 'string' && pattern.test(`s:cur:${ENV_STORE_SLUG}`))!;
    const { ctx, edits } = createMockCtx(ADMIN_ID);
    ctx.callbackQuery.data = `s:cur:${ENV_STORE_SLUG}`;
    ctx.match = ctx.callbackQuery.data.match(entry.pattern as RegExp);
    await entry.fn(ctx);
    assert.equal(envApiCalls, 1);
    assert.equal(edits.length, 1);
    assert.match(edits[0], /staging\.test/);
  }

  // 9. Legacy pre-multistore callback (s:cur without slug) hits fallback cleanly
  {
    const entry = callbacks.find(({ pattern }) => typeof pattern !== 'string' && pattern.test('s:cur'))!;
    const { ctx, callbacks: cbAnswers } = createMockCtx(ADMIN_ID);
    ctx.callbackQuery.data = 's:cur';
    await entry.fn(ctx);
    assert.equal(cbAnswers[0]?.show_alert, true);
    assert.match(cbAnswers[0]?.text ?? '', /устарел/i);
  }
});

test('Checklist errors: 401, 403, 400, network, timeout, 5xx produce readable localized messages', () => {
  const cases: Array<[WpBrandSaleError, RegExp]> = [
    [new WpBrandSaleError('auth', 'Invalid password', 401), /401/],
    [new WpBrandSaleError('forbidden', 'Forbidden', 403), /403/],
    [new WpBrandSaleError('validation', 'end must be > start', 400, 'invalid_dates'), /end must be &gt; start/],
    [new WpBrandSaleError('network', 'ENOTFOUND'), /недоступен/],
    [new WpBrandSaleError('timeout', '15s'), /15 секунд/],
    [new WpBrandSaleError('server', 'HTTP 502', 502), /5xx/],
  ];
  for (const [err, pattern] of cases) {
    const msg = formatWpError(err, 'ru');
    assert.match(msg, pattern);
  }
});
