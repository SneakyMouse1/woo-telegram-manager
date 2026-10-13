import { prisma } from '../src/config/prisma.js';
import { encrypt } from '../src/utils/crypto.js';
import { WooCommerceService } from '../src/services/woocommerceService.js';
import { provisionWebhooks } from '../src/services/webhookProvisioner.js';

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
        process.exit(1);
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

async function getSecret(envVar: string, promptText: string): Promise<string> {
  if (process.env[envVar]) {
    return process.env[envVar]!.trim();
  }
  if (!process.stdin.isTTY) {
    throw new Error(`In non-interactive mode, the ${envVar} variable must be set`);
  }
  return promptHidden(promptText);
}

async function parseOrPromptArgs(): Promise<{ name: string; url: string; dryRun: boolean }> {
  const args = process.argv.slice(2);
  let name = '';
  let url = '';
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name' && args[i + 1]) {
      name = args[i + 1].trim();
      i++;
    } else if (args[i] === '--url' && args[i + 1]) {
      url = args[i + 1].trim();
      i++;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    }
  }

  if (!name || !url) {
    if (!process.stdin.isTTY) {
      console.error('Usage: npx tsx scripts/add-store.ts --name <slug> --url <https://...> [--dry-run]');
      process.exit(1);
    }
    if (!name) {
      name = await promptVisible('Enter store slug (up to 16 characters, e.g. shop-a): ');
    }
    if (!url) {
      url = await promptVisible('Enter store URL (e.g. https://example.com): ');
    }
  }

  return { name, url, dryRun };
}

async function main() {
  const { name, url: rawUrl, dryRun } = await parseOrPromptArgs();

  // 1. Validate slug name (1-16 chars, lowercase alphanumeric + hyphen)
  const slugRegex = /^[a-z0-9-]{1,16}$/;
  if (!slugRegex.test(name)) {
    console.error(`❌ Invalid store name format "${name}". Only lowercase alphanumeric characters and hyphens (1-16 chars) are allowed.`);
    process.exit(1);
  }

  // 2. Validate URL (https, no trailing slash)
  let cleanUrl = rawUrl.replace(/\/+$/, '');
  if (!cleanUrl.startsWith('https://')) {
    console.error('❌ Store URL must start with https://');
    process.exit(1);
  }

  try {
    new URL(cleanUrl);
  } catch {
    console.error(`❌ Invalid URL: "${cleanUrl}"`);
    process.exit(1);
  }

  // 3. Check uniqueness in DB
  const existingName = await prisma.store.findUnique({ where: { name } });
  if (existingName) {
    console.error(`❌ Store with name "${name}" already exists in database.`);
    process.exit(1);
  }

  const existingUrl = await prisma.store.findUnique({ where: { url: cleanUrl } });
  if (existingUrl) {
    console.error(`❌ Store with URL "${cleanUrl}" already exists in database.`);
    process.exit(1);
  }

  // 4. Request WooCommerce credentials (STORE_CK / STORE_CS or interactive prompt)
  const ck = await getSecret('STORE_CK', '🔑 Enter WooCommerce Consumer Key (ck_...): ');
  const cs = await getSecret('STORE_CS', '🔑 Enter WooCommerce Consumer Secret (cs_...): ');

  const ckRegex = /^ck_[0-9a-fA-F]{40}$/;
  const csRegex = /^cs_[0-9a-fA-F]{40}$/;

  if (!ckRegex.test(ck)) {
    console.error('❌ Consumer Key does not match format ^ck_[0-9a-fA-F]{40}$');
    process.exit(1);
  }

  if (!csRegex.test(cs)) {
    console.error('❌ Consumer Secret does not match format ^cs_[0-9a-fA-F]{40}$');
    process.exit(1);
  }

  // 5. Test connection to WooCommerce live before DB write
  console.log(`[Store] Testing WooCommerce connection (${cleanUrl})...`);
  const testClient = new WooCommerceService(cleanUrl, ck, cs);

  try {
    await testClient.getOrders({ per_page: 1 });
    console.log('✅ WooCommerce connection verified successfully!');
  } catch (testErr) {
    console.error('❌ WooCommerce credentials verification failed:', (testErr as Error).message);
    process.exit(1);
  }

  if (dryRun) {
    console.log('[Store] [DRY RUN] Store addition plan:');
    console.log(`  • Slug name: ${name}`);
    console.log(`  • URL: ${cleanUrl}`);
    console.log(`  • Credentials verified and valid`);
    console.log(`  • Database write and webhook setup skipped (--dry-run).`);
    return;
  }

  // 6. Write store to DB with encrypted keys
  const store = await prisma.store.create({
    data: {
      name,
      url: cleanUrl,
      apiKeyEncrypted: encrypt(ck),
      apiSecretEncrypted: encrypt(cs),
      isActive: true,
    },
  });

  console.log(`✅ Store saved to DB: "${store.name}" (ID: ${store.id})`);

  // 7. Provision webhooks safely
  await provisionWebhooks(store);

  console.log(`\n🎉 Store "${store.name}" (ID: ${store.id}) added successfully and ready to use!`);
}

main()
  .catch((err) => {
    console.error('❌ Error executing add-store:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
