import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWpBrandSaleClient, WpBrandSaleError } from '../src/services/wpBrandSaleClient.js';

const PASSWORD = 'abcd EFGH ijkl MNOP qrst UVWX';

const SALE = {
  version: 7,
  start: 1793000000,
  end: 1793600000,
  active: false,
  now: 1792000000,
  discounts: { '665': 50, '661': 30 },
  brands: { '665': { name: 'Alpha', discount: 50 }, '661': { name: 'Beta', discount: 30 } },
};

type Call = { url: string; init: RequestInit };

function mockFetch(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (url: any, init: any) => {
    const call = { url: String(url), init };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return { impl, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function client(impl: typeof fetch, extra: Record<string, unknown> = {}) {
  return createWpBrandSaleClient(
    { baseUrl: 'https://staging.example.com/', user: 'bot', appPassword: PASSWORD, ...extra },
    impl
  );
}

test('rejects non-https base URL', () => {
  assert.throws(
    () => createWpBrandSaleClient({ baseUrl: 'http://x.test', user: 'u', appPassword: 'p' }),
    (e: any) => e instanceof WpBrandSaleError && e.kind === 'config'
  );
});

test('sends Basic auth, correct URL and no redirects', async () => {
  const { impl, calls } = mockFetch(() => json(200, SALE));
  const sale = await client(impl).getSale();
  assert.equal(calls[0].url, 'https://staging.example.com/wp-json/wc-brand-sale/v1/brand-sale');
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Basic ' + Buffer.from(`bot:${PASSWORD}`).toString('base64'));
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(sale.version, '7');
  assert.deepEqual(sale.discounts, { '665': 50, '661': 30 });
});

test('PUT sends the full config as JSON', async () => {
  const { impl, calls } = mockFetch(() => json(200, { ...SALE, version: 8 }));
  const res = await client(impl).saveSale({ start: 1, end: 2, discounts: { '665': 50 } });
  assert.equal(calls[0].init.method, 'PUT');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { start: 1, end: 2, discounts: { '665': 50 } });
  assert.equal(res.version, '8');
});

test('DELETE ends the sale', async () => {
  const { impl, calls } = mockFetch(() => json(200, { ...SALE, active: false }));
  await client(impl).endSale();
  assert.equal(calls[0].init.method, 'DELETE');
});

test('accepts PHP empty-array maps and null dates (no sale configured)', async () => {
  const { impl } = mockFetch(() =>
    json(200, { version: '0', start: null, end: 0, active: false, now: 1, discounts: [], brands: [] })
  );
  const sale = await client(impl).getSale();
  assert.deepEqual(sale.discounts, {});
  assert.equal(sale.start, null);
  assert.equal(sale.end, null);
});

test('brands are cached for the TTL, force bypasses the cache', async () => {
  const { impl, calls } = mockFetch(() => json(200, [{ id: 665, name: 'Alpha', taxonomy: 'product_brand', count: 3 }]));
  const c = client(impl);
  const a = await c.getBrands();
  const b = await c.getBrands();
  assert.equal(calls.length, 1);
  assert.deepEqual(a, b);
  await c.getBrands({ force: true });
  assert.equal(calls.length, 2);
});

test('brand cache expires', async () => {
  const { impl, calls } = mockFetch(() => json(200, []));
  const c = client(impl, { brandsCacheTtlMs: 0 });
  await c.getBrands();
  await c.getBrands();
  assert.equal(calls.length, 2);
});

for (const [status, kind] of [
  [401, 'auth'],
  [403, 'forbidden'],
  [400, 'validation'],
  [404, 'not_found'],
  [500, 'server'],
  [503, 'server'],
] as const) {
  test(`HTTP ${status} maps to "${kind}" with code/message and no secrets`, async () => {
    const { impl } = mockFetch(() => json(status, { code: 'invalid_range', message: '<b>end</b> must be after start' }));
    await assert.rejects(client(impl).getSale(), (e: any) => {
      assert.ok(e instanceof WpBrandSaleError);
      assert.equal(e.kind, kind);
      assert.equal(e.status, status);
      assert.equal(e.code, 'invalid_range');
      assert.equal(e.message, 'end must be after start');
      assert.ok(!JSON.stringify({ ...e, m: e.message }).includes(PASSWORD));
      return true;
    });
  });
}

test('HTML 5xx page still produces a readable error', async () => {
  const { impl } = mockFetch(() => new Response('<html>Bad gateway</html>', { status: 502 }));
  await assert.rejects(client(impl).getSale(), (e: any) => e.kind === 'server' && e.message === 'HTTP 502');
});

test('redirect is reported, not followed', async () => {
  const { impl } = mockFetch(() => new Response(null, { status: 301, headers: { Location: 'https://evil.test' } }));
  await assert.rejects(client(impl).getSale(), (e: any) => e.kind === 'bad_response');
});

test('network failure maps to "network"', async () => {
  const { impl } = mockFetch(() => {
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
  });
  await assert.rejects(client(impl).getSale(), (e: any) => e.kind === 'network' && /ENOTFOUND/.test(e.message));
});

test('timeout maps to "timeout"', async () => {
  const impl = ((_url: any, init: any) =>
    new Promise((_res, rej) => {
      init.signal.addEventListener('abort', () => rej(init.signal.reason));
    })) as typeof fetch;
  await assert.rejects(client(impl, { timeoutMs: 50 }).getSale(), (e: any) => e.kind === 'timeout');
});

test('unexpected payload maps to "bad_response"', async () => {
  const { impl } = mockFetch(() => json(200, { hello: 'world' }));
  await assert.rejects(client(impl).getSale(), (e: any) => e.kind === 'bad_response');
});
