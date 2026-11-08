import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMadrid, parseMadridDate } from '../src/bot/sale/madridTime.js';
import {
  checkSaleAdmin,
  getSaleStatus,
  groupByPercent,
  parsePercent,
  SaleEditError,
  withBrandPercent,
  withDates,
  withoutBrand,
} from '../src/bot/sale/saleLogic.js';
import {
  clearPendingSaleInput,
  getPendingSaleInput,
  resetSaleInputOnUpdate,
  SALE_INPUT_TTL_MS,
  setPendingSaleInput,
} from '../src/bot/sale/saleInputStore.js';
import { handleSaleTextInput, isSaleAdmin } from '../src/bot/sale/saleHandlers.js';
import type { BrandSale } from '../src/services/wpBrandSaleClient.js';

// ==========================================
// Europe/Madrid time & DST tests
// ==========================================

test('parseMadridDate: winter CET (UTC+1) start and inclusive end of day', () => {
  // 15.01.2026 is CET (UTC+1)
  // 00:00:00 Madrid -> 2026-01-14T23:00:00Z
  const start = parseMadridDate('15.01.2026', 'start');
  assert.equal(start, Math.floor(Date.UTC(2026, 0, 14, 23, 0, 0) / 1000));
  assert.equal(formatMadrid(start!), '15.01.2026 00:00');

  // 23:59:59 Madrid -> 2026-01-15T22:59:59Z
  const end = parseMadridDate('15.01.2026', 'end');
  assert.equal(end, Math.floor(Date.UTC(2026, 0, 15, 22, 59, 59) / 1000));
  assert.equal(formatMadrid(end!), '15.01.2026 23:59');
});

test('parseMadridDate: summer CEST (UTC+2) start and inclusive end of day', () => {
  // 15.07.2026 is CEST (UTC+2)
  // 00:00:00 Madrid -> 2026-07-14T22:00:00Z
  const start = parseMadridDate('15.07.2026', 'start');
  assert.equal(start, Math.floor(Date.UTC(2026, 6, 14, 22, 0, 0) / 1000));
  assert.equal(formatMadrid(start!), '15.07.2026 00:00');

  // 23:59:59 Madrid -> 2026-07-15T21:59:59Z
  const end = parseMadridDate('15.07.2026', 'end');
  assert.equal(end, Math.floor(Date.UTC(2026, 6, 15, 21, 59, 59) / 1000));
  assert.equal(formatMadrid(end!), '15.07.2026 23:59');
});

test('DST spring forward in Madrid (29.03.2026: CET UTC+1 at 00:00 -> CEST UTC+2 at 23:59:59)', () => {
  // Before transition on 29.03.2026 00:00:00 Madrid -> still CET (UTC+1) = 2026-03-28T23:00:00Z
  const start = parseMadridDate('29.03.2026', 'start');
  assert.equal(start, Math.floor(Date.UTC(2026, 2, 28, 23, 0, 0) / 1000));
  assert.equal(formatMadrid(start!), '29.03.2026 00:00');

  // After transition on 29.03.2026 23:59:59 Madrid -> CEST (UTC+2) = 2026-03-29T21:59:59Z
  // (The day is 23 hours long: 82799 seconds between start and end)
  const end = parseMadridDate('29.03.2026', 'end');
  assert.equal(end, Math.floor(Date.UTC(2026, 2, 29, 21, 59, 59) / 1000));
  assert.equal(end! - start!, 23 * 3600 - 1);
  assert.equal(formatMadrid(end!), '29.03.2026 23:59');
});

test('DST fall back in Madrid (25.10.2026: CEST UTC+2 at 00:00 -> CET UTC+1 at 23:59:59)', () => {
  // Before transition on 25.10.2026 00:00:00 Madrid -> still CEST (UTC+2) = 2026-10-24T22:00:00Z
  const start = parseMadridDate('25.10.2026', 'start');
  assert.equal(start, Math.floor(Date.UTC(2026, 9, 24, 22, 0, 0) / 1000));
  assert.equal(formatMadrid(start!), '25.10.2026 00:00');

  // After transition on 25.10.2026 23:59:59 Madrid -> CET (UTC+1) = 2026-10-25T22:59:59Z
  // (The day is 25 hours long: 89999 seconds between start and end)
  const end = parseMadridDate('25.10.2026', 'end');
  assert.equal(end, Math.floor(Date.UTC(2026, 9, 25, 22, 59, 59) / 1000));
  assert.equal(end! - start!, 25 * 3600 - 1);
  assert.equal(formatMadrid(end!), '25.10.2026 23:59');
});

test('parseMadridDate rejects invalid calendar dates and bad strings', () => {
  assert.equal(parseMadridDate('31.02.2026', 'start'), null);
  assert.equal(parseMadridDate('29.02.2026', 'start'), null); // 2026 is not leap
  assert.equal(parseMadridDate('00.01.2026', 'start'), null);
  assert.equal(parseMadridDate('15.13.2026', 'start'), null);
  assert.equal(parseMadridDate('2026-01-15', 'start'), null);
  assert.equal(parseMadridDate('abc', 'end'), null);
});

// ==========================================
// Current sale logic tests
// ==========================================

const sampleSale: BrandSale = {
  version: '3',
  start: 1000,
  end: 2000,
  active: true,
  now: 1500,
  discounts: { '665': 50, '661': 30, '700': 50 },
  brands: {
    '665': { name: 'Zeta', discount: 50 },
    '661': { name: 'Alpha', discount: 30 },
    '700': { name: 'Beta', discount: 50 },
  },
};

test('getSaleStatus reports none, scheduled, running, ended', () => {
  assert.equal(getSaleStatus({ start: null, end: null, now: 1500, discounts: {} }), 'none');
  assert.equal(getSaleStatus({ ...sampleSale, now: 500 }), 'scheduled');
  assert.equal(getSaleStatus({ ...sampleSale, now: 1500 }), 'running');
  assert.equal(getSaleStatus({ ...sampleSale, now: 2000 }), 'ended');
});

test('groupByPercent sorts groups descending by % and brands alphabetically', () => {
  const groups = groupByPercent(sampleSale.discounts, {
    '665': 'Zeta',
    '661': 'Alpha',
    '700': 'Beta',
  });
  assert.equal(groups.length, 2);
  assert.equal(groups[0].pct, 50);
  assert.deepEqual(
    groups[0].brands.map((b) => b.name),
    ['Beta', 'Zeta']
  );
  assert.equal(groups[1].pct, 30);
  assert.deepEqual(
    groups[1].brands.map((b) => b.name),
    ['Alpha']
  );
});

test('parsePercent accepts integers 1..90 and rejects others', () => {
  assert.equal(parsePercent('1'), 1);
  assert.equal(parsePercent('90%'), 90);
  assert.equal(parsePercent(' 45 % '), 45);
  assert.equal(parsePercent('0'), null);
  assert.equal(parsePercent('91'), null);
  assert.equal(parsePercent('-10'), null);
  assert.equal(parsePercent('25.5'), null);
});

test('withBrandPercent returns full config with updated brand and does not mutate original', () => {
  const cfg = withBrandPercent(sampleSale, '661', 40);
  assert.deepEqual(cfg, {
    start: 1000,
    end: 2000,
    discounts: { '665': 50, '661': 40, '700': 50 },
  });
  assert.equal(sampleSale.discounts['661'], 30);
});

test('withoutBrand removes a brand, but forbids removing the last brand', () => {
  const cfg1 = withoutBrand(sampleSale, '661');
  assert.deepEqual(cfg1.discounts, { '665': 50, '700': 50 });

  const oneBrandSale: BrandSale = {
    ...sampleSale,
    discounts: { '665': 50 },
  };
  assert.throws(
    () => withoutBrand(oneBrandSale, '665'),
    (e: any) => e instanceof SaleEditError && e.code === 'LAST_BRAND'
  );
});

test('withDates validates end > start and end > now', () => {
  const ok = withDates(sampleSale, 1200, 3000);
  assert.equal(ok.start, 1200);
  assert.equal(ok.end, 3000);

  assert.throws(
    () => withDates(sampleSale, 3000, 2500),
    (e: any) => e instanceof SaleEditError && e.code === 'END_BEFORE_START'
  );
  assert.throws(
    () => withDates(sampleSale, 1000, 1400),
    (e: any) => e instanceof SaleEditError && e.code === 'END_IN_PAST'
  );
});

// ==========================================
// saleInputStore: exit via "Back" or command
// ==========================================

test('saleInputStore: exiting "custom %" via Back (s:ebs:<id>) clears state so plain text and commands are not intercepted', () => {
  const chatId = 123456;
  clearPendingSaleInput(chatId);

  // 1. User opens "custom %" for brand 665
  setPendingSaleInput(chatId, { kind: 'edit_brand_pct', brandId: '665', messageId: 10 });
  assert.deepEqual(getPendingSaleInput(chatId), { kind: 'edit_brand_pct', brandId: '665', messageId: 10 });

  // 2. User clicks "Back" button (callback_data: s:ebs:665)
  resetSaleInputOnUpdate({ chatId, callbackData: 's:ebs:665' });

  // 3. Subsequent ordinary text message (e.g. product search "shampoo") is NOT intercepted
  resetSaleInputOnUpdate({ chatId, messageText: 'shampoo' });
  assert.equal(getPendingSaleInput(chatId), undefined);

  // 4. Subsequent command (/orders) is NOT intercepted
  resetSaleInputOnUpdate({ chatId, messageText: '/orders' });
  assert.equal(getPendingSaleInput(chatId), undefined);
});

test('saleInputStore: exiting date input (start or end) via Back (s:cur) or command clears state', () => {
  const chatId = 123456;
  clearPendingSaleInput(chatId);

  // 1. User opens "Edit dates" -> start date prompt
  setPendingSaleInput(chatId, { kind: 'edit_dates_start', messageId: 11 });
  assert.equal(getPendingSaleInput(chatId)?.kind, 'edit_dates_start');

  // 2. User clicks "Back" (callback_data: s:cur)
  resetSaleInputOnUpdate({ chatId, callbackData: 's:cur' });
  assert.equal(getPendingSaleInput(chatId), undefined);

  // 3. User opens "Edit dates" -> end date prompt, then sends a slash command (/brands)
  setPendingSaleInput(chatId, { kind: 'edit_dates_end', startUnix: 1793000000, messageId: 12 });
  assert.equal(getPendingSaleInput(chatId)?.kind, 'edit_dates_end');

  resetSaleInputOnUpdate({ chatId, messageText: '/brands' });
  assert.equal(getPendingSaleInput(chatId), undefined);

  // 4. Ordinary text message after command is NOT intercepted
  resetSaleInputOnUpdate({ chatId, messageText: 'serum' });
  assert.equal(getPendingSaleInput(chatId), undefined);
});

test('saleInputStore: expires after 10 minutes (SALE_INPUT_TTL_MS) of inactivity', () => {
  const chatId = 777888;
  const t0 = 1_700_000_000_000;
  assert.equal(SALE_INPUT_TTL_MS, 10 * 60 * 1000);

  setPendingSaleInput(chatId, { kind: 'edit_brand_pct', brandId: '665', messageId: 1 }, t0);

  // Still active 1 ms before 10 minutes
  assert.deepEqual(getPendingSaleInput(chatId, t0 + SALE_INPUT_TTL_MS - 1), {
    kind: 'edit_brand_pct',
    brandId: '665',
    messageId: 1,
  });

  // Expired at exactly 10 minutes -> returns undefined and purges entry
  assert.equal(getPendingSaleInput(chatId, t0 + SALE_INPUT_TTL_MS), undefined);
  assert.equal(getPendingSaleInput(chatId, t0 + SALE_INPUT_TTL_MS + 5000), undefined);
});

test('isSaleAdmin & handleSaleTextInput: non-admin cannot trigger sale text input even if pending state exists', async () => {
  const ADMIN_ID = '900001';
  const NON_ADMIN_ID = 555555;

  assert.equal(checkSaleAdmin(900001, ADMIN_ID), true);
  assert.equal(checkSaleAdmin(900001n, ADMIN_ID), true);
  assert.equal(checkSaleAdmin(NON_ADMIN_ID, ADMIN_ID), false);
  assert.equal(checkSaleAdmin(undefined, ADMIN_ID), false);
  assert.equal(isSaleAdmin(NON_ADMIN_ID, ADMIN_ID), false);
  assert.equal(isSaleAdmin(900001, ADMIN_ID), true);

  // Put a pending state under NON_ADMIN_ID and verify handleSaleTextInput refuses to run
  setPendingSaleInput(NON_ADMIN_ID, { kind: 'edit_brand_pct', brandId: '665', messageId: 42 });

  let apiCalled = false;
  const fakeClient: any = {
    getSale: async () => {
      apiCalled = true;
      return sampleSale;
    },
  };
  const fakeNonAdminCtx: any = {
    from: { id: NON_ADMIN_ID },
    chat: { id: NON_ADMIN_ID },
    message: { text: '45' },
  };

  const handled = await handleSaleTextInput(fakeNonAdminCtx, fakeClient, ADMIN_ID);
  assert.equal(handled, false);
  assert.equal(apiCalled, false);

  clearPendingSaleInput(NON_ADMIN_ID);
});

