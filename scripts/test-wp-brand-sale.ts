/**
 * Integration & staged live-test script for the WordPress brand-sale REST API.
 *
 * Modes:
 *   1. Basic read-only check (no flags):
 *        npx tsx scripts/test-wp-brand-sale.ts
 *   2. Custom sale dry-run (read-only plan + WooCommerce sample products):
 *        npx tsx scripts/test-wp-brand-sale.ts \
 *          --discounts "TOCOBO=10;VT COSMETICS=20;SOME BY MI=15" \
 *          --end "2026-11-08 05:00" \
 *          --dry-run
 *   3. Custom sale write without auto-ending (--write --no-end):
 *        npx tsx scripts/test-wp-brand-sale.ts \
 *          --discounts "TOCOBO=10;VT COSMETICS=20;SOME BY MI=15" \
 *          --end "2026-11-08 05:00" \
 *          --write --no-end
 *
 * Never prints WP_USER or WP_APP_PASSWORD. Never writes without --write.
 */
import 'dotenv/config';
import {
  createWpBrandSaleClient,
  WpBrandSaleError,
  type BrandSale,
  type WpBrand,
} from '../src/services/wpBrandSaleClient.js';
import {
  formatMadridWithSeconds,
  parseMadridDateTime,
} from '../src/bot/sale/madridTime.js';
import { isValidPercent } from '../src/bot/sale/saleLogic.js';
import { prisma } from '../src/config/prisma.js';
import { decrypt } from '../src/utils/crypto.js';
import {
  WooCommerceService,
  type WooProduct,
  type WooProductVariation,
} from '../src/services/woocommerceService.js';

interface ParsedArgs {
  write: boolean;
  dryRun: boolean;
  noEnd: boolean;
  discountsRaw?: string;
  endRaw?: string;
}

function parseCliArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    write: false,
    dryRun: false,
    noEnd: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--write') out.write = true;
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--no-end') out.noEnd = true;
    else if (arg === '--discounts') {
      out.discountsRaw = argv[++i];
    } else if (arg.startsWith('--discounts=')) {
      out.discountsRaw = arg.slice('--discounts='.length);
    } else if (arg === '--end') {
      out.endRaw = argv[++i];
    } else if (arg.startsWith('--end=')) {
      out.endRaw = arg.slice('--end='.length);
    }
  }
  return out;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/gi, '&')
    .replace(/&#038;/g, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/gi, "'")
    .trim();
}

function normalizeBrandName(s: string): string {
  return decodeHtmlEntities(s).replace(/\s+/g, ' ').trim().toLowerCase();
}

function parseDiscountsArg(raw: string): Array<{ queryName: string; pct: number }> {
  const pairs = raw
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean);
  if (pairs.length === 0) {
    throw new Error('--discounts is empty');
  }
  const result: Array<{ queryName: string; pct: number }> = [];
  for (const pair of pairs) {
    const eqIdx = pair.lastIndexOf('=');
    if (eqIdx <= 0 || eqIdx === pair.length - 1) {
      throw new Error(`Invalid discount pair "${pair}". Expected "BRAND NAME=PCT" separated by ";"`);
    }
    const queryName = pair.slice(0, eqIdx).trim();
    const pctStr = pair.slice(eqIdx + 1).trim();
    if (!/^-?\d+$/.test(pctStr)) {
      throw new Error(`Invalid percentage "${pctStr}" for brand "${queryName}": must be an integer 1..90`);
    }
    const pct = Number(pctStr);
    if (!isValidPercent(pct)) {
      throw new Error(`Invalid percentage ${pct} for brand "${queryName}": must be an integer between 1 and 90`);
    }
    result.push({ queryName, pct });
  }
  return result;
}

function describeSale(s: BrandSale): string {
  const fmt = (ts: number | null) =>
    ts ? `${formatMadridWithSeconds(ts)} Europe/Madrid (unix: ${ts})` : '—';
  return `version=${s.version} | active=${s.active} | start=${fmt(s.start)} | end=${fmt(s.end)} | brands=${Object.keys(s.discounts).length}`;
}

interface SampleProductCheck {
  brandId: number;
  brandName: string;
  pct: number;
  kind: 'simple' | 'variable';
  productId: number;
  variationId?: number;
  title: string;
  regularPrice: number;
  decimals: number;
  preExistingSalePrice: number | null;
  expectedPrice: number;
  note?: string;
}

function detectDecimals(priceStr?: string): number {
  if (!priceStr) return 2;
  const dot = priceStr.indexOf('.');
  return dot === -1 ? 2 : Math.max(2, priceStr.length - dot - 1);
}

function roundTo(num: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((num + Number.EPSILON) * factor) / factor;
}

async function getWooClientForWpUrl(wpUrl: string): Promise<WooCommerceService | null> {
  if (process.env.WP_USER && process.env.WP_APP_PASSWORD) {
    return new WooCommerceService(wpUrl, process.env.WP_USER, process.env.WP_APP_PASSWORD);
  }
  try {
    const cleanTarget = wpUrl.replace(/\/+$/, '').toLowerCase();
    const stores = await prisma.store.findMany({ where: { isActive: true } });
    const matched =
      stores.find((s) => s.url.replace(/\/+$/, '').toLowerCase() === cleanTarget) ?? stores[0];
    if (matched) {
      const key = decrypt(matched.apiKeyEncrypted);
      const secret = decrypt(matched.apiSecretEncrypted);
      return new WooCommerceService(matched.url, key, secret);
    }
  } catch {}
  return null;
}

async function collectBrandSampleProducts(
  woo: WooCommerceService,
  resolvedBrands: Array<{ brand: WpBrand; pct: number }>
): Promise<SampleProductCheck[]> {
  const samples: SampleProductCheck[] = [];

  for (const { brand, pct } of resolvedBrands) {
    let products: WooProduct[] = [];
    try {
      products = await woo.getProductsByBrand(brand.id, { per_page: 40 });
    } catch (err: any) {
      console.log(`   ⚠️  [${brand.name}] getProductsByBrand(${brand.id}) failed: ${err?.message || err}`);
      continue;
    }

    if (!products || products.length === 0) {
      console.log(`   ℹ️  [${brand.name}] No products returned by /wc/v3/products?brand=${brand.id}`);
      continue;
    }

    // 1. Pick one simple product with a valid regular_price
    const simple = products.find(
      (p) => p.type === 'simple' && p.regular_price && parseFloat(p.regular_price) > 0
    );
    if (simple && simple.regular_price) {
      const decimals = detectDecimals(simple.regular_price);
      const reg = parseFloat(simple.regular_price);
      const calc = roundTo(reg * (1 - pct / 100), decimals);
      const manualSale =
        simple.sale_price && simple.sale_price !== '' ? parseFloat(simple.sale_price) : null;
      let note: string | undefined;
      if (manualSale !== null && !Number.isNaN(manualSale)) {
        if (manualSale < calc) {
          note = `manual sale_price=${manualSale.toFixed(decimals)} is lower than calculated ${calc.toFixed(decimals)}`;
        } else {
          note = `existing manual sale_price=${manualSale.toFixed(decimals)}`;
        }
      }
      samples.push({
        brandId: brand.id,
        brandName: decodeHtmlEntities(brand.name),
        pct,
        kind: 'simple',
        productId: simple.id,
        title: simple.name,
        regularPrice: reg,
        decimals,
        preExistingSalePrice: manualSale,
        expectedPrice: calc,
        note,
      });
    }

    // 2. Pick one variable product and inspect its first variation with a valid regular_price
    const variableCandidates = products.filter((p) => p.type === 'variable');
    let pickedVar: { parent: WooProduct; variation: WooProductVariation } | null = null;
    for (const vp of variableCandidates) {
      try {
        const vars = await woo.getProductVariations(vp.id, { per_page: 20 });
        const validVar = vars.find((v) => v.regular_price && parseFloat(v.regular_price) > 0);
        if (validVar) {
          pickedVar = { parent: vp, variation: validVar };
          break;
        }
      } catch {
        // skip if variations endpoint failed for this product
      }
    }

    if (pickedVar && pickedVar.variation.regular_price) {
      const { parent, variation } = pickedVar;
      const regStr = variation.regular_price!;
      const decimals = detectDecimals(regStr);
      const reg = parseFloat(regStr);
      const calc = roundTo(reg * (1 - pct / 100), decimals);
      const manualSale =
        variation.sale_price && variation.sale_price !== ''
          ? parseFloat(variation.sale_price)
          : null;
      let note: string | undefined;
      if (manualSale !== null && !Number.isNaN(manualSale)) {
        if (manualSale < calc) {
          note = `manual sale_price=${manualSale.toFixed(decimals)} is lower than calculated ${calc.toFixed(decimals)}`;
        } else {
          note = `existing manual sale_price=${manualSale.toFixed(decimals)}`;
        }
      }
      const attrLabel =
        variation.attributes?.map((a) => `${a.name}: ${a.option}`).join(', ') || `var #${variation.id}`;
      samples.push({
        brandId: brand.id,
        brandName: decodeHtmlEntities(brand.name),
        pct,
        kind: 'variable',
        productId: parent.id,
        variationId: variation.id,
        title: `${parent.name} [${attrLabel}]`,
        regularPrice: reg,
        decimals,
        preExistingSalePrice: manualSale,
        expectedPrice: calc,
        note,
      });
    }
  }

  return samples;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const { WP_URL, WP_USER, WP_APP_PASSWORD } = process.env;
  if (!WP_URL || !WP_USER || !WP_APP_PASSWORD) {
    console.error('❌ WP_URL, WP_USER, WP_APP_PASSWORD must be set in .env');
    process.exit(1);
  }

  const host = new URL(WP_URL).host;
  const modeLabel = args.write
    ? args.noEnd
      ? 'WRITE (--no-end)'
      : 'WRITE'
    : args.dryRun
      ? 'DRY-RUN (read-only)'
      : 'read-only';
  console.log(`🌐 Target host: ${host}  |  mode: ${modeLabel}\n`);

  const wp = createWpBrandSaleClient({
    baseUrl: WP_URL,
    user: WP_USER,
    appPassword: WP_APP_PASSWORD,
  });

  // If no custom --discounts / --end provided, run standard integration check
  if (!args.discountsRaw && !args.endRaw) {
    const brands = await wp.getBrands();
    console.log(`✅ getBrands(): ${brands.length} brands`);
    console.log(
      '   first 5:',
      brands
        .slice(0, 5)
        .map((b) => `${b.id}:${decodeHtmlEntities(b.name)} (${b.count})`)
        .join(', ')
    );
    const t0 = Date.now();
    await wp.getBrands();
    console.log(`✅ getBrands() cached: ${Date.now() - t0} ms`);

    const before = await wp.getSale();
    console.log(`✅ getSale(): ${describeSale(before)}`);
    if (!args.write) {
      console.log('\nℹ️  Read-only run complete.');
    }
    return;
  }

  if (!args.discountsRaw || !args.endRaw) {
    console.error('❌ Both --discounts and --end must be provided together.');
    process.exit(1);
  }

  // 1. Parse --discounts and --end
  const requestedDiscounts = parseDiscountsArg(args.discountsRaw);
  const endUnix = parseMadridDateTime(args.endRaw);
  if (endUnix === null) {
    console.error(
      `❌ Invalid --end "${args.endRaw}". Expected "YYYY-MM-DD HH:MM[:SS]" or "DD.MM.YYYY HH:MM[:SS]" in Europe/Madrid.`
    );
    process.exit(1);
  }

  // 2. Fetch live brands and current sale state
  const [allBrands, currentSale] = await Promise.all([
    wp.getBrands({ force: true }),
    wp.getSale(),
  ]);

  console.log(`📊 Current getSale() state:`);
  console.log(`   ${describeSale(currentSale)}`);
  if (Object.keys(currentSale.discounts).length > 0) {
    console.log(`   Current discounts: ${JSON.stringify(currentSale.discounts)}`);
  }
  console.log('');

  // 3. Resolve and validate brands by case-insensitive name
  const resolvedBrands: Array<{ brand: WpBrand; pct: number }> = [];
  let hasAmbiguousOrMissing = false;

  console.log(`🏷  Matching brands (${allBrands.length} total in getBrands()):`);
  for (const item of requestedDiscounts) {
    const targetNorm = normalizeBrandName(item.queryName);
    const candidates = allBrands.filter((b) => normalizeBrandName(b.name) === targetNorm);

    if (candidates.length === 0) {
      hasAmbiguousOrMissing = true;
      console.error(`   ❌ Brand "${item.queryName}" NOT FOUND in getBrands().`);
      const partial = allBrands.filter((b) =>
        normalizeBrandName(b.name).includes(targetNorm)
      );
      if (partial.length > 0) {
        console.error(
          `      Similar: ${partial
            .map((p) => `id=${p.id} "${decodeHtmlEntities(p.name)}" (taxonomy=${p.taxonomy}, count=${p.count})`)
            .join('; ')}`
        );
      }
      continue;
    }

    if (candidates.length > 1) {
      hasAmbiguousOrMissing = true;
      const withStock = candidates.filter((c) => c.count > 0);
      const withoutStock = candidates.filter((c) => c.count === 0);
      console.error(
        `   ⚠️  Multiple candidates found for "${item.queryName}" (${candidates.length}):`
      );
      for (const c of candidates) {
        console.error(
          `      - id=${c.id} | name="${decodeHtmlEntities(c.name)}" | taxonomy=${c.taxonomy} | count=${c.count}`
        );
      }
      if (withStock.length === 1 && withoutStock.length === candidates.length - 1) {
        console.error(
          `      💡 Preferred candidate (only one with count > 0): id=${withStock[0].id} (taxonomy=${withStock[0].taxonomy}, count=${withStock[0].count}). Stopping for confirmation.`
        );
      }
      continue;
    }

    const matched = candidates[0];
    resolvedBrands.push({ brand: matched, pct: item.pct });
    console.log(
      `   ✅ id=${matched.id} | "${decodeHtmlEntities(matched.name)}" | taxonomy=${matched.taxonomy} | count=${matched.count} | discount: −${item.pct}%`
    );
  }

  if (hasAmbiguousOrMissing) {
    console.error('\n🛑 Stopping: not all brands were unambiguously matched.');
    process.exit(1);
  }

  // 4. Plan dates & check >= 30 minutes remaining
  const startUnix = currentSale.now;
  const remainingSec = endUnix - startUnix;
  const remainingMin = Math.floor(remainingSec / 60);

  console.log('\n📅 Date window plan (Europe/Madrid):');
  console.log(
    `   start (site now): ${formatMadridWithSeconds(startUnix)} Europe/Madrid  (unix: ${startUnix})`
  );
  console.log(
    `   end   (target):   ${formatMadridWithSeconds(endUnix)} Europe/Madrid  (unix: ${endUnix})`
  );
  console.log(`   duration:         ${remainingMin} min (${remainingSec} s)`);

  if (remainingSec <= 0) {
    console.error('\n🛑 Stopping: target end time has already passed relative to WordPress server time.');
    process.exit(1);
  }
  if (remainingSec < 30 * 60) {
    console.error(
      `\n🛑 Stopping: less than 30 minutes remaining until end (${remainingMin} min).`
    );
    process.exit(1);
  }

  const discountsPayload: Record<string, number> = {};
  for (const { brand, pct } of resolvedBrands) {
    discountsPayload[String(brand.id)] = pct;
  }
  console.log(`\n📦 Final payload for PUT /brand-sale:`);
  console.log(`   ${JSON.stringify({ start: startUnix, end: endUnix, discounts: discountsPayload })}`);

  // 5. Inspect sample products via WooCommerceService (read-only)
  const woo = await getWooClientForWpUrl(WP_URL);
  let sampleProducts: SampleProductCheck[] = [];
  if (woo) {
    console.log('\n🛍  Selecting sample products via WooCommerce REST API (1 simple + 1 variable per brand):');
    sampleProducts = await collectBrandSampleProducts(woo, resolvedBrands);
    if (sampleProducts.length === 0) {
      console.log('   ℹ️  Could not select sample products by brand via WooCommerce API.');
    } else {
      for (const sp of sampleProducts) {
        const idLabel = sp.variationId
          ? `product #${sp.productId} / variation #${sp.variationId}`
          : `product #${sp.productId}`;
        const noteStr = sp.note ? `  ⚠️ [${sp.note}]` : '';
        console.log(
          `   • [${sp.brandName} −${sp.pct}%] (${sp.kind}) ${idLabel}: "${sp.title}" | regular=${sp.regularPrice.toFixed(sp.decimals)} -> expected discounted: ${sp.expectedPrice.toFixed(sp.decimals)}${noteStr}`
        );
      }
    }
  } else {
    console.log('\nℹ️  Store not found or unreachable in local DB, skipping WooCommerce product check.');
  }

  // 6. Stop here if dry-run or --write not passed
  if (!args.write || args.dryRun) {
    console.log('\n✅ Dry-run complete (no changes written to the site).');
    return;
  }

  // 7. Write mode: call saveSale() once
  console.log('\n🚀 Calling saveSale() (PUT /brand-sale)...');
  let saved: BrandSale;
  try {
    saved = await wp.saveSale({
      start: startUnix,
      end: endUnix,
      discounts: discountsPayload,
    });
  } catch (err: any) {
    console.error(`\n❌ saveSale() error: ${err?.message || err}`);
    if (err instanceof WpBrandSaleError) {
      console.error(`   kind=${err.kind} status=${err.status ?? '—'} code=${err.code ?? '—'}`);
    }
    try {
      const checkState = await wp.getSale();
      console.error(`   Actual getSale() state after error: ${describeSale(checkState)}`);
    } catch (e2: any) {
      console.error(`   Failed to re-read getSale(): ${e2?.message || e2}`);
    }
    process.exit(1);
  }

  console.log('✅ saveSale() response:');
  console.log(`   version:   ${saved.version}`);
  console.log(`   active:    ${saved.active}`);
  console.log(
    `   start:     ${ saved.start ? `${formatMadridWithSeconds(saved.start)} Europe/Madrid (unix: ${saved.start})` : '—' }`
  );
  console.log(
    `   end:       ${ saved.end ? `${formatMadridWithSeconds(saved.end)} Europe/Madrid (unix: ${saved.end})` : '—' }`
  );
  console.log(`   discounts: ${JSON.stringify(saved.discounts)}`);

  // 8. Re-fetch sample products from WooCommerce REST and compare prices
  if (woo && sampleProducts.length > 0) {
    console.log('\n🔎 Verifying sample product prices via WooCommerce REST after activation:');
    console.log('Brand | Product | Type | Regular | Expected | Actual (price / sale_price)');
    console.log('------|---------|------|---------|----------|----------------------------');
    for (const sp of sampleProducts) {
      try {
        if (sp.kind === 'simple') {
          const fresh = await woo.getProduct(sp.productId);
          console.log(
            `${sp.brandName} (−${sp.pct}%) | #${sp.productId} ${sp.title} | simple | ${sp.regularPrice.toFixed(sp.decimals)} | ${sp.expectedPrice.toFixed(sp.decimals)} | price=${fresh.price} / sale_price=${fresh.sale_price || '—'} (on_sale=${fresh.on_sale})`
          );
        } else if (sp.variationId) {
          const freshVar = await woo.getProductVariation(sp.productId, sp.variationId);
          console.log(
            `${sp.brandName} (−${sp.pct}%) | #${sp.productId}/v#${sp.variationId} ${sp.title} | variable | ${sp.regularPrice.toFixed(sp.decimals)} | ${sp.expectedPrice.toFixed(sp.decimals)} | price=${freshVar.price} / sale_price=${freshVar.sale_price || '—'} (on_sale=${freshVar.on_sale})`
          );
        }
      } catch (err: any) {
        console.log(
          `${sp.brandName} (−${sp.pct}%) | #${sp.productId} | ${sp.kind} | read error: ${err?.message || err}`
        );
      }
    }
  }

  if (args.noEnd) {
    console.log(
      '\n⚠️  --no-end flag is active: endSale() was NOT called and previous config was NOT restored.'
    );
    console.log(
      '👉 Reminder: end the test sale manually using the "End sale now" button in the bot.'
    );
  }
}

main()
  .catch((e) => {
    if (e instanceof WpBrandSaleError) {
      console.error(
        `❌ [${e.kind}${e.status ? ' ' + e.status : ''}${e.code ? ' ' + e.code : ''}] ${e.message}`
      );
    } else {
      console.error(`❌ ${e?.message || e}`);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await prisma.$disconnect();
    } catch {}
  });
