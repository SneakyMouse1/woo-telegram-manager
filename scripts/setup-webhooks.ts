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
    console.error('Usage: npx tsx scripts/setup-webhooks.ts --store <name> [--dry-run]');
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
    console.error(`❌ Store "${storeName}" not found in database.`);
    process.exit(1);
  }

  console.log(`[SetupWebhooks] Found store "${store.name}" (ID: ${store.id})`);

  const result = await provisionWebhooks(store, { dryRun });

  if (result.dryRun) {
    console.log('[SetupWebhooks] [DRY RUN] Plan verified successfully. No changes made.');
  } else {
    console.log(`✅ [SetupWebhooks] Webhooks for store "${store.name}" updated successfully!`);
  }
}

main()
  .catch((err) => {
    console.error('❌ Error executing setup-webhooks:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
