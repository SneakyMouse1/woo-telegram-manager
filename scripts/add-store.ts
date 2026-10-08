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
    throw new Error(`В неинтерактивном режиме необходимо задать переменную ${envVar}`);
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
      console.error('Использование: npx tsx scripts/add-store.ts --name <slug> --url <https://...> [--dry-run]');
      process.exit(1);
    }
    if (!name) {
      name = await promptVisible('Введите slug магазина (до 16 символов, например shop-a): ');
    }
    if (!url) {
      url = await promptVisible('Введите URL магазина (например https://example.com): ');
    }
  }

  return { name, url, dryRun };
}

async function main() {
  const { name, url: rawUrl, dryRun } = await parseOrPromptArgs();

  // 1. Validate slug name (1-16 chars, lowercase alphanumeric + hyphen)
  const slugRegex = /^[a-z0-9-]{1,16}$/;
  if (!slugRegex.test(name)) {
    console.error(`❌ Неверный формат имени магазина "${name}". Допустимы только строчная латиница, цифры и дефис, длиной от 1 до 16 символов.`);
    process.exit(1);
  }

  // 2. Validate URL (https, no trailing slash)
  let cleanUrl = rawUrl.replace(/\/+$/, '');
  if (!cleanUrl.startsWith('https://')) {
    console.error('❌ URL магазина должен начинаться с https://');
    process.exit(1);
  }

  try {
    new URL(cleanUrl);
  } catch {
    console.error(`❌ Некорректный URL: "${cleanUrl}"`);
    process.exit(1);
  }

  // 3. Check uniqueness in DB
  const existingName = await prisma.store.findUnique({ where: { name } });
  if (existingName) {
    console.error(`❌ Магазин с именем "${name}" уже существует в базе данных.`);
    process.exit(1);
  }

  const existingUrl = await prisma.store.findUnique({ where: { url: cleanUrl } });
  if (existingUrl) {
    console.error(`❌ Магазин с URL "${cleanUrl}" уже существует в базе данных.`);
    process.exit(1);
  }

  // 4. Request WooCommerce credentials (STORE_CK / STORE_CS or interactive prompt)
  const ck = await getSecret('STORE_CK', '🔑 Введите WooCommerce Consumer Key (ck_...): ');
  const cs = await getSecret('STORE_CS', '🔑 Введите WooCommerce Consumer Secret (cs_...): ');

  const ckRegex = /^ck_[0-9a-fA-F]{40}$/;
  const csRegex = /^cs_[0-9a-fA-F]{40}$/;

  if (!ckRegex.test(ck)) {
    console.error('❌ Consumer Key не соответствует формату ^ck_[0-9a-fA-F]{40}$');
    process.exit(1);
  }

  if (!csRegex.test(cs)) {
    console.error('❌ Consumer Secret не соответствует формату ^cs_[0-9a-fA-F]{40}$');
    process.exit(1);
  }

  // 5. Test connection to WooCommerce live before DB write
  console.log(`[Store] Проверка подключения к WooCommerce (${cleanUrl})...`);
  const testClient = new WooCommerceService(cleanUrl, ck, cs);

  try {
    await testClient.getOrders({ per_page: 1 });
    console.log('✅ Подключение к WooCommerce успешно проверено!');
  } catch (testErr) {
    console.error('❌ Ошибка проверки ключей WooCommerce:', (testErr as Error).message);
    process.exit(1);
  }

  if (dryRun) {
    console.log('[Store] [DRY RUN] План добавления магазина:');
    console.log(`  • Имя (slug): ${name}`);
    console.log(`  • URL: ${cleanUrl}`);
    console.log(`  • Ключи проверены и валидны`);
    console.log(`  • Запись в БД и настройка вебхуков пропущены (--dry-run).`);
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

  console.log(`✅ Магазин сохранён в БД: "${store.name}" (ID: ${store.id})`);

  // 7. Provision webhooks safely
  await provisionWebhooks(store);

  console.log(`\n🎉 Магазин "${store.name}" (ID: ${store.id}) успешно добавлен и готов к работе!`);
}

main()
  .catch((err) => {
    console.error('❌ Ошибка выполнения add-store:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
