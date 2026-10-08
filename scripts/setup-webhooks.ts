import { prisma } from '../src/config/prisma.js';
import { provisionWebhooks } from '../src/services/webhookProvisioner.js';

function parseCliArgs(): { storeName: string; dryRun: boolean } {
  const args = process.argv.slice(2);
  let storeName = '';
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--store' && args[i + 1]) {
      storeName = args[i + 1].trim();
      i++;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    }
  }

  if (!storeName) {
    console.error('Использование: npx tsx scripts/setup-webhooks.ts --store <name> [--dry-run]');
    process.exit(1);
  }

  return { storeName, dryRun };
}

async function main() {
  const { storeName, dryRun } = parseCliArgs();

  const store = await prisma.store.findFirst({
    where: {
      name: { equals: storeName, mode: 'insensitive' },
    },
  });

  if (!store) {
    console.error(`❌ Магазин "${storeName}" не найден в базе данных.`);
    process.exit(1);
  }

  console.log(`[SetupWebhooks] Найден магазин "${store.name}" (ID: ${store.id})`);

  const result = await provisionWebhooks(store, { dryRun });

  if (result.dryRun) {
    console.log('[SetupWebhooks] [DRY RUN] План успешно проверен, изменения не внесены.');
  } else {
    console.log(`✅ [SetupWebhooks] Вебхуки для магазина "${store.name}" успешно обновлены!`);
  }
}

main()
  .catch((err) => {
    console.error('❌ Ошибка выполнения setup-webhooks:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
