import { prisma } from '../src/config/prisma.js';
import { env } from '../src/config/env.js';
import { encrypt } from '../src/utils/crypto.js';
import {
  createWpBrandSaleClient,
  normalizeSiteUrl,
  WpBrandSaleError,
} from '../src/services/wpBrandSale.js';

function promptHidden(promptText: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(promptText);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.setRawMode) {
      stdin.setRawMode(true);
    }
    stdin.resume();

    let input = '';
    const onData = (buf: Buffer) => {
      const char = buf.toString('utf8');
      if (char === '\n' || char === '\r' || char === '\u0004') {
        if (stdin.setRawMode) {
          stdin.setRawMode(wasRaw || false);
        }
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(input.trim());
      } else if (char === '\u0003') {
        process.stdout.write('\n');
        process.exit(130);
      } else if (char === '\b' || char === '\x7f') {
        if (input.length > 0) {
          input = input.slice(0, -1);
        }
      } else {
        input += char;
      }
    };
    stdin.on('data', onData);
  });
}

function promptVisible(promptText: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(promptText);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.setRawMode) {
      stdin.setRawMode(true);
    }
    stdin.resume();

    let input = '';
    const onData = (buf: Buffer) => {
      const char = buf.toString('utf8');
      if (char === '\n' || char === '\r' || char === '\u0004') {
        if (stdin.setRawMode) {
          stdin.setRawMode(wasRaw || false);
        }
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(input.trim());
      } else if (char === '\u0003') {
        process.stdout.write('\n');
        process.exit(130);
      } else if (char === '\b' || char === '\x7f') {
        if (input.length > 0) {
          input = input.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else {
        input += char;
        process.stdout.write(char);
      }
    };
    stdin.on('data', onData);
  });
}

function parseCliArgs(): { storeName: string; dryRun: boolean; clear: boolean } {
  const args = process.argv.slice(2);
  let storeName = '';
  let dryRun = false;
  let clear = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--store' && args[i + 1]) {
      storeName = args[i + 1].trim();
      i++;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--clear') {
      clear = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(
        'Usage:\n' +
          '  npm run store:discounts -- --store <slug> [--dry-run]\n' +
          '  npm run store:discounts -- --store <slug> --clear [--dry-run]\n\n' +
          'Non-interactive env vars:\n' +
          '  STORE_WP_USER          WordPress username (must have manage_woocommerce)\n' +
          '  STORE_WP_APP_PASSWORD  WordPress Application Password'
      );
      process.exit(0);
    }
  }

  return { storeName, dryRun, clear };
}

async function getInputOrEnv(
  envVar: string,
  promptText: string,
  hidden: boolean
): Promise<string> {
  if (process.env[envVar]?.trim()) {
    return process.env[envVar]!.trim();
  }
  if (!process.stdin.isTTY) {
    throw new Error(`In non-interactive mode, the ${envVar} environment variable must be set.`);
  }
  return hidden ? promptHidden(promptText) : promptVisible(promptText);
}

async function main() {
  let { storeName, dryRun, clear } = parseCliArgs();

  if (!storeName) {
    const stores = await prisma.store.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    if (stores.length === 0) {
      console.error('❌ No active stores found in database. Run "npm run store:add" first.');
      process.exit(1);
    }
    if (!process.stdin.isTTY) {
      console.error('Usage: npm run store:discounts -- --store <slug> [--dry-run] [--clear]');
      process.exit(1);
    }
    console.log('Available active stores:');
    for (const s of stores) {
      const configured = Boolean(s.wpUserEncrypted && s.wpAppPasswordEncrypted);
      console.log(`  • ${s.name} (${s.url}) — DB discounts creds: ${configured ? '✅ set' : '⚪️ not set'}`);
    }
    storeName = await promptVisible('\nEnter store slug to configure: ');
  }

  const store = await prisma.store.findFirst({
    where: {
      name: { equals: storeName, mode: 'insensitive' },
    },
  });

  if (!store) {
    console.error(`❌ Store "${storeName}" not found in database.`);
    process.exit(1);
  }

  console.log(`[SetupDiscounts] Store "${store.name}" (${store.url}, active=${store.isActive})`);

  if (clear) {
    if (dryRun) {
      console.log(`[SetupDiscounts] [DRY RUN] Would clear DB WordPress credentials for "${store.name}".`);
      return;
    }
    await prisma.store.update({
      where: { id: store.id },
      data: {
        wpUserEncrypted: null,
        wpAppPasswordEncrypted: null,
      },
    });
    console.log(`✅ Cleared per-store WordPress credentials for "${store.name}".`);
    if (env.WP_URL && env.WP_USER && env.WP_APP_PASSWORD && normalizeSiteUrl(store.url) === normalizeSiteUrl(env.WP_URL)) {
      console.log(
        `ℹ️  Note: .env fallback (WP_URL=${env.WP_URL}) still matches this store's URL, so /discounts will fall back to .env credentials.`
      );
    }
    return;
  }

  const wpUser = await getInputOrEnv(
    'STORE_WP_USER',
    '👤 Enter WordPress username (with manage_woocommerce): ',
    false
  );
  const wpAppPassword = await getInputOrEnv(
    'STORE_WP_APP_PASSWORD',
    '🔑 Enter WordPress Application Password (hidden): ',
    true
  );

  if (!wpUser || !wpAppPassword) {
    console.error('❌ Both WordPress username and Application Password are required.');
    process.exit(1);
  }

  console.log(`[SetupDiscounts] Verifying wc-brand-sale/v1 API on ${store.url}...`);
  const testClient = createWpBrandSaleClient({
    baseUrl: store.url,
    user: wpUser,
    appPassword: wpAppPassword,
  });

  try {
    const [sale, brands] = await Promise.all([
      testClient.getSale(),
      testClient.getBrands({ force: true }),
    ]);
    console.log(
      `✅ WordPress Brand Sale API verified! (${brands.length} brands found, active sale: ${sale.active ? 'yes' : 'no'})`
    );
  } catch (err) {
    if (err instanceof WpBrandSaleError) {
      console.error(`❌ Verification failed [${err.kind}]: ${err.message}`);
      if (err.kind === 'not_found') {
        console.error('   Make sure wordpress/wc-brand-sale.php is installed and activated on this site.');
      } else if (err.kind === 'auth') {
        console.error('   Verify the WordPress username and Application Password (Users -> Profile -> Application Passwords).');
      } else if (err.kind === 'forbidden') {
        console.error('   Ensure this WordPress user has the manage_woocommerce capability.');
      }
    } else {
      console.error('❌ Verification failed:', (err as Error).message);
    }
    process.exit(1);
  }

  if (dryRun) {
    console.log('[SetupDiscounts] [DRY RUN] Plan verified successfully:');
    console.log(`  • Store: ${store.name} (${store.url})`);
    console.log('  • Credentials verified via GET /wp-json/wc-brand-sale/v1/brand-sale and /brands');
    console.log('  • Database write skipped (--dry-run).');
    return;
  }

  await prisma.store.update({
    where: { id: store.id },
    data: {
      wpUserEncrypted: encrypt(wpUser),
      wpAppPasswordEncrypted: encrypt(wpAppPassword),
    },
  });

  console.log(`\n🎉 Brand discounts configured and encrypted in DB for store "${store.name}"!`);
  console.log('   All active managers attached to this store (and the admin) can now use /discounts.');
}

main()
  .catch((err) => {
    console.error('❌ Error executing setup-discounts:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
