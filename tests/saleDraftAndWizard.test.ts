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
} from '../src/bot/sale/saleFormatter.js';
import {
  applySaleInputResetMiddleware,
  executeWizardConfirm,
  handleSaleTextInput,
  registerSaleHandlers,
} from '../src/bot/sale/saleHandlers.js';
import { withBrandPercent } from '../src/bot/sale/saleLogic.js';
import { WpBrandSaleError, type BrandSale, type WpBrand } from '../src/services/wpBrandSaleClient.js';

const SAMPLE_BRANDS: WpBrand[] = [
  { id: 665, name: 'Alpha', taxonomy: 'product_brand', count: 10 },
  { id: 661, name: 'Beta', taxonomy: 'product_brand', count: 8 },
  { id: 700, name: 'Gamma', taxonomy: 'product_brand', count: 4 },
];

function createMockCtx(chatId: number, fromId = chatId, messageId = 100) {
  const edits: string[] = [];
  const replies: string[] = [];
  const callbacks: Array<{ text?: string; show_alert?: boolean }> = [];
  const ctx: any = {
    chat: { id: chatId },
    from: { id: fromId, language_code: 'ru' },
    callbackQuery: {
      data: 's:ncf',
      message: { message_id: messageId },
    },
    api: {
      editMessageText: async (_c: any, _m: any, text: string) => {
        edits.push(text);
      },
      deleteMessage: async () => {},
    },
    reply: async (text: string) => {
      replies.push(text);
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
  const view1 = renderWizardPickBrands(draft, brands, 'ru');
  const rows1 = view1.reply_markup.inline_keyboard;

  assert.equal(rows1.length, 13);
  assert.equal(rows1[0].length, 2);
  assert.match(rows1[0][0].text, /🔒.*50%/);
  assert.match(rows1[0][1].text, /^✅ /);

  const view2 = renderWizardPickBrands({ ...draft, page: 2 }, brands, 'ru');
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

test('SaleDraft store saves after each step, ignores drafts older than 24h, and clears on cancel/save', async () => {
  const store = createMemorySaleDraftStore();
  const adminId = 900001n;

  const d1 = await store.save(adminId, createInitialDraft(100));
  assert.equal((await store.get(adminId))?.step, 'pick_pct');

  const d2 = await store.save(
    adminId,
    toggleDraftBrand(startGroupSelection(d1, 50), '665', 'Alpha').draft
  );
  assert.deepEqual((await store.get(adminId))?.currentBrandIds, ['665']);

  const d3 = await store.save(adminId, commitCurrentGroup(d2)!);
  assert.equal((await store.get(adminId))?.step, 'ask_more_groups');

  const t0 = 1_700_000_000_000;
  store.setUpdatedAt(adminId, t0);
  assert.equal(isDraftExpired(t0, t0 + DRAFT_TTL_MS), false);
  assert.ok(await store.get(adminId, t0 + DRAFT_TTL_MS));

  assert.equal(isDraftExpired(t0, t0 + DRAFT_TTL_MS + 1), true);
  assert.equal(await store.get(adminId, t0 + DRAFT_TTL_MS + 1), null);

  await store.save(adminId, d3);
  await store.clear(adminId);
  assert.equal(await store.get(adminId), null);
});

test('wizard text input: exiting via slash command or Back stops intercepting plain text', async () => {
  const store = createMemorySaleDraftStore();
  const ADMIN_ID = '900001';
  const chatId = 900001;

  await store.save(chatId, {
    ...createInitialDraft(55),
    step: 'await_custom_pct',
    awaitingText: true,
  });

  await applySaleInputResetMiddleware(
    {
      chat: { id: chatId } as any,
      from: { id: chatId } as any,
      message: { text: '/orders' } as any,
      callbackQuery: undefined,
    },
    ADMIN_ID,
    store
  );

  const afterCmd = await store.get(chatId);
  assert.equal(afterCmd?.awaitingText, false);

  const consumed = await handleSaleTextInput(
    {
      from: { id: chatId },
      chat: { id: chatId },
      message: { text: 'crema hidratante' },
    } as any,
    {} as any,
    ADMIN_ID,
    store
  );
  assert.equal(consumed, false);
});

test('confirm and replace-warning screens render dates, brand groups and separate replacement buttons', () => {
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

  const confirmView = renderWizardConfirm(draft, names, 'ru');
  assert.match(confirmView.text, /Alpha → <b>−50%<\/b>/);
  assert.match(confirmView.text, /Beta → <b>−30%<\/b>/);
  const confirmBtn = confirmView.reply_markup.inline_keyboard[0][0];
  assert.equal('callback_data' in confirmBtn ? confirmBtn.callback_data : undefined, 's:ncf');

  const replaceView = renderWizardReplaceWarning({ ...draft, step: 'confirm_replace' }, names, 'ru');
  assert.match(replaceView.text, /полностью заменена/);
  const replaceBtn = replaceView.reply_markup.inline_keyboard[0][0];
  assert.equal('callback_data' in replaceBtn ? replaceBtn.callback_data : undefined, 's:nrp');
});

// ==========================================
// FIX 1: startNow=true is resolved at Confirm time, not when clicking "Now"
// ==========================================

test('startNow=true does not freeze unix timestamp on click; resolves fresh now at Confirm time (e.g. next day)', async () => {
  const store = createMemorySaleDraftStore();
  const chatId = 900001;

  // Day 1: admin clicks "Now"
  let draft = createInitialDraft(100);
  draft = {
    ...draft,
    groups: [{ pct: 50, brandIds: ['665'] }],
    brandNames: { '665': 'Alpha' },
  };
  const afterNowClick = selectStartNowOnDraft(draft);
  assert.equal(afterNowClick.startNow, true);
  assert.equal(afterNowClick.startUnix, undefined);

  // Admin enters an end date 5 days ahead and reaches 'confirm'
  const day1Now = 1_790_000_000;
  const nextDayNow = day1Now + 86_400; // +24 hours later when admin clicks Confirm
  const endUnix = day1Now + 5 * 86_400;

  await store.save(chatId, {
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
  await executeWizardConfirm(ctx, 'initial', 'ru', mockClient, store);

  assert.ok(savedPayload, 'saveSale should have been called');
  assert.equal(savedPayload.start, nextDayNow, 'start must be nextDayNow, not yesterday');
  assert.equal(savedPayload.end, endUnix);
  assert.equal(await store.get(chatId), null, 'draft must be cleared after save');
});

// ==========================================
// FIX 2: Confirm re-validates end > now & end > start and returns to await_end_date
// ==========================================

test('executeWizardConfirm re-checks end > now and end > start before saveSale() and returns to end-date step if expired', async () => {
  const store = createMemorySaleDraftStore();
  const chatId = 900001;

  // Draft has endUnix = 2000, but by the time admin clicks Confirm, server now is 2500
  await store.save(chatId, {
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
  await executeWizardConfirm(ctx, 'initial', 'ru', mockClient, store);

  assert.equal(saveCalled, false, 'saveSale must NOT be called when end <= now');
  const updatedDraft = await store.get(chatId);
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
  await store.save(chatId, draft);
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
  await executeWizardConfirm(ctx, 'initial', 'ru', mockClient, store);
  assert.equal(saveCalled, false);
  assert.match(edits[0], /DeletedCosmetics/);
  const savedAfterPrune = await store.get(chatId);
  assert.deepEqual(savedAfterPrune?.groups, [{ pct: 50, brandIds: ['665'] }]);
});

// ==========================================
// STEP 4 CHECKLIST: E2E scenario, Access Control, Error formatting
// ==========================================

test('Checklist scenario: 2 groups -> confirm -> Current sale shows same -> change 1 brand % -> end sale', async () => {
  const store = createMemorySaleDraftStore();
  const chatId = 900001;
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
  await store.save(chatId, d);

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
  await executeWizardConfirm(ctx, 'initial', 'ru', client, store);
  assert.equal(state.version, '2');
  assert.deepEqual(state.discounts, { '665': 50, '661': 30 });

  // 2. "Current sale" renders the exact same groups and status
  const curView1 = renderCurrentSale(await client.getSale(), {}, 'ru');
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
  const curViewAfterEnd = renderCurrentSale(ended, {}, 'ru');
  assert.match(curViewAfterEnd.text, /🔴 Закончилась/);
});

test('Checklist access control: non-admin cannot invoke /discounts or any s:* callback', async () => {
  const ADMIN_ID = '900001';
  const INTRUDER_ID = 444444;
  const commands = new Map<string, (ctx: any) => Promise<void>>();
  const callbacks: Array<{ pattern: string | RegExp; fn: (ctx: any) => Promise<void> }> = [];

  const fakeBot: any = {
    use: () => {},
    command: (name: string, fn: any) => commands.set(name, fn),
    callbackQuery: (pattern: string | RegExp, fn: any) => callbacks.push({ pattern, fn }),
  };

  let apiTouched = false;
  const guardedClient: any = {
    isConfigured: () => true,
    getBrands: async () => {
      apiTouched = true;
      return [];
    },
    getSale: async () => {
      apiTouched = true;
      return {};
    },
    saveSale: async () => {
      apiTouched = true;
      return {};
    },
    endSale: async () => {
      apiTouched = true;
      return {};
    },
  };

  registerSaleHandlers(fakeBot, guardedClient, createMemorySaleDraftStore(), ADMIN_ID);

  // 1. Intruder tries /discounts
  const { ctx: cmdCtx, replies, edits } = createMockCtx(INTRUDER_ID, INTRUDER_ID);
  await commands.get('discounts')!(cmdCtx);
  assert.equal(replies.length, 0);
  assert.equal(edits.length, 0);
  assert.equal(apiTouched, false);

  // 2. Intruder tries representative callbacks across all actions
  const testDataList = [
    's:m',
    's:cur',
    's:eb:1',
    's:ebs:665',
    's:ebp:665:40',
    's:ebc:665',
    's:ebr:665',
    's:ed',
    's:eds:now',
    's:ede:keep:1790000000',
    's:end:ask',
    's:end:do',
    's:new',
    's:nrs',
    's:npk',
    's:npct:50',
    's:npc',
    's:t:665',
    's:np:2',
    's:nd',
    's:na:y',
    's:ns:now',
    's:ncf',
    's:nrp',
    's:nx',
  ];

  for (const data of testDataList) {
    const entry = callbacks.find(({ pattern }) =>
      typeof pattern === 'string' ? pattern === data : pattern.test(data)
    );
    assert.ok(entry, `handler must exist for ${data}`);
    const { ctx: cbCtx, replies: r, edits: e } = createMockCtx(INTRUDER_ID, INTRUDER_ID);
    cbCtx.callbackQuery.data = data;
    cbCtx.match = typeof entry.pattern === 'string' ? [data] : data.match(entry.pattern);
    await entry.fn(cbCtx);
    assert.equal(r.length, 0, `intruder must get no reply on ${data}`);
    assert.equal(e.length, 0, `intruder must get no edit on ${data}`);
    assert.equal(apiTouched, false, `WP API must not be touched by intruder on ${data}`);
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
