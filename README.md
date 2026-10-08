# WooCommerce Telegram Manager

Production-grade backend service and Telegram bot for managing **multiple WooCommerce stores** with strict isolation. Built with Express, TypeScript, PostgreSQL (Prisma), and grammY. Provides real-time order alerts, one-tap status updates, catalog search, sales reporting, and WhatsApp customer communication.

---

## Table of Contents

- [Key Features](#key-features)
- [Architecture & Isolation](#architecture--isolation)
- [B2B Wholesale Detection & Customization](#b2b-wholesale-detection--customization)
- [Database Schema](#database-schema)
- [Security Architecture](#security-architecture)
- [Environment Configuration](#environment-configuration)
- [Store Management via CLI](#store-management-via-cli)
- [Telegram Bot Commands & Roles](#telegram-bot-commands--roles)
- [Testing Suite](#testing-suite)
- [Production Deployment](#production-deployment)
- [Project Structure](#project-structure)

---

## Key Features

- **Multi-Store Management (N-Stores)** — Single backend and bot instance managing multiple isolated WooCommerce stores (e.g. `shop-a`, `shop-b`).
- **Strict Store Isolation** — Managers only see and interact with stores they are explicitly assigned to. All bot callbacks enforce store-level permission checks.
- **Real-Time Order Notifications** — Instant Telegram alerts for incoming orders (`order.created`, `order.updated`) delivered via store-scoped webhooks (`/api/webhooks/woocommerce/:storeId`).
- **One-Tap Status Updates** — Inline keyboards to change order statuses (`Processing`, `Completed`, `On-Hold`) directly from Telegram with instant order card refresh.
- **WhatsApp Integration** — Instant direct chat links (`https://wa.me/<phone>`) with automatic international E.164 phone formatting.
- **B2B Wholesale Detection** — Automatically detects wholesale B2B orders (e.g. B2BKing metadata and corporate billing) with dedicated visual badges.
- **Catalog Search & Relevance** — Fast text search for products and brands with exact title priority and pagination. Search queries are cached server-side to keep callback payloads minimal.
- **Financial Analytics (`/reports`)** — Sales metrics across flexible periods (7 days, month, quarter, year-to-date, previous year, custom years) and Top 10 customer leaderboards.
- **Trilingual Localization** — Automatic Telegram client language matching with manual switching via `/language` for English (EN), Spanish (ES), and Russian (RU).

---

## Architecture & Isolation

```
                                  ┌───────────────────────────┐
                                  │      Telegram API         │
                                  └─────────────┬─────────────┘
                                                │ Long Polling
                                                ▼
┌─────────────────────────┐         ┌─────────────────────────┐         ┌─────────────────────────┐
│   WooCommerce: shop-a   │────────▶│  Woo Telegram Manager   │◀────────│   WooCommerce: shop-b   │
│ Webhook: /.../:storeIdA │  HMAC   │  (Express + grammY)     │  HMAC   │ Webhook: /.../:storeIdB │
└─────────────────────────┘         └───────────┬─────────────┘         └─────────────────────────┘
                                                │ Prisma
                                                ▼
                                    ┌─────────────────────────┐
                                    │       PostgreSQL        │
                                    │ (Store, User, Member)   │
                                    └─────────────────────────┘
```

1. **Store Resolution**: Every Telegram bot interaction resolves store context via `resolveStore(chatId, storeSlug)`. If a user is not an active member of the store (and is not the bot administrator), access is rejected immediately.
2. **Stateless Multi-Store UX**: If a manager belongs to more than one store and issues a command without specifying a store (e.g. `/orders`), an interactive store selector is displayed.
3. **Telegram Callback Constraint**: Telegram limits `callback_data` to 64 bytes. To ensure payloads never exceed this limit:
   - Store slugs are strictly limited to 16 characters.
   - Search queries are referenced by an 8-character hex hash with server-side TTL caching rather than embedding raw search text.
   - Longest callback payload (`st:<slug>:<orderId>:processing`) is approximately 41 bytes, well below the 64-byte threshold.

---

## B2B Wholesale Detection & Customization

The service automatically classifies orders as either wholesale **B2B** or retail **B2C**:
- **Detailed Notifications & Cards**: Tagged with localized badges (e.g. `🏢 B2B Order` vs. `👤 B2C Retail`).
- **Order Lists (`/orders`)**: Tagged with compact labels `[🏢 B2B]` or `[👤 B2C]` next to each order.

### Default Detection: B2BKing Plugin

Out of the box, B2B classification is powered by the popular [B2BKing](https://woocommerce-b2b-plugin.com/) wholesale plugin for WooCommerce:
1. Checks if `order.meta_data` contains `b2bking_is_b2b_order` with value `"yes"`.
2. Fallback check: If `order.billing.company` is non-empty, the order is also treated as B2B.

### How to Customize for Your Own Plugins or Data

All B2B classification logic is centralized in a single helper function in [`src/bot/formatters/orderFormatter.ts`](file:///Users/simonsmyslov/Desktop/WorkProjects/woo-telegram-manager/src/bot/formatters/orderFormatter.ts):

```typescript
// src/bot/formatters/orderFormatter.ts

export function isB2BOrder(order: WooOrder): boolean {
  const b2bMeta = order.meta_data?.find((m) => m.key === 'b2bking_is_b2b_order');
  return b2bMeta?.value === 'yes' || Boolean(order.billing?.company?.trim());
}
```

Any modification to `isB2BOrder()` instantly applies across **all** real-time webhook alerts, order detail cards, and `/orders` list views.

#### Scenario 1: Using a Different B2B Plugin or Custom Checkout Meta Key
If your store uses a different plugin (e.g. *WooCommerce Wholesale Prices*, *B2B eCommerce*, or a custom ACF/checkout field), simply adjust the meta key check:

```typescript
// Example: Checking a custom meta key or Wholesale Prices plugin
export function isB2BOrder(order: WooOrder): boolean {
  // Replace 'your_custom_meta_key' with your actual field name
  const customMeta = order.meta_data?.find((m) => m.key === 'custom_b2b_flag');
  const isWholesale = customMeta?.value === 'yes' || customMeta?.value === 'true';

  return isWholesale || Boolean(order.billing?.company?.trim());
}
```

#### Scenario 2: Displaying Custom B2B Fields (VAT ID, CIF/NIF, Tax Number)
To display additional B2B fields (such as VAT ID or registration numbers) in the customer information block of the order card, add them to `formatOrderMessage()` in [`src/bot/formatters/orderFormatter.ts`](file:///Users/simonsmyslov/Desktop/WorkProjects/woo-telegram-manager/src/bot/formatters/orderFormatter.ts):

```typescript
// In formatOrderMessage() inside customerBlock construction:
const vatMeta = order.meta_data?.find((m) =>
  ['b2bking_custom_field_vat', 'vat_number', '_billing_vat', 'tax_id'].includes(m.key)
);

if (vatMeta?.value) {
  customerBlock += `\n🏢 NIF/CIF: <code>${escapeHtml(String(vatMeta.value))}</code>`;
}
```

---

## Database Schema

Managed via Prisma (`prisma/schema.prisma`):

- **`Store`**
  - `id` (UUID, primary key)
  - `name` (String, unique, slug <= 16 chars, e.g. `shop-a`)
  - `url` (String, unique, e.g. `https://shop-a.example.com`)
  - `apiKeyEncrypted`, `apiSecretEncrypted`, `webhookSecretEncrypted` (AES-256-GCM encrypted credentials)
  - `isActive` (Boolean, default `true`)
  - `createdAt` (DateTime)
- **`ChatUser`**
  - `chatId` (BigInt, primary key, Telegram user ID)
  - `label` (String, human-readable name/role, e.g. "Manager Anna")
  - `language` (String, `ru` | `en` | `es`, default `ru`)
  - `isManual` (Boolean, default `false`)
  - `isActive` (Boolean, default `true`)
  - `createdAt` (DateTime)
- **`StoreMember`**
  - `chatId` (BigInt, references `ChatUser.chatId`, `onDelete: Cascade`)
  - `storeId` (UUID, references `Store.id`, `onDelete: Cascade`)
  - `createdAt` (DateTime)
  - Primary key: `@@id([chatId, storeId])`

---

## Security Architecture

1. **Zero-Trust Bot Access**: The bot ignores all updates from unknown users. Only users whose `chatId` matches `ADMIN_CHAT_ID` or exists in `ChatUser` with `isActive = true` are processed. Unknown users can only execute `/start <CODE>` to activate valid invitation links.
2. **AES-256-GCM Credential Encryption**: All WooCommerce API keys and webhook secrets stored in the database are encrypted using AES-256-GCM with authenticated tags and unique 12-byte initialization vectors (IVs).
3. **HMAC-SHA256 Webhook Verification**:
   - Webhook requests to `/api/webhooks/woocommerce/:storeId` require a valid `x-wc-webhook-signature` header.
   - Verification uses timing-safe constant-time comparison against the raw body buffer (`req.rawBody`).
   - If an unknown store ID is passed or HMAC fails, a generic `401 Unauthorized` is returned without leaking store existence.
   - Supports zero-downtime secret rotation via dual-secret format (`<newSecret>|<oldSecret>`).

> [!CAUTION]
> **CRITICAL: ENCRYPTION_KEY PRESERVATION**
> `ENCRYPTION_KEY` is a 64-character (32-byte) hex string. It is used to encrypt and decrypt all store credentials.
> **Never lose or change `ENCRYPTION_KEY` after stores have been added.** If this key is lost, existing encrypted credentials in the database cannot be decrypted and all store keys must be re-entered.

---

## Environment Configuration

Copy `.env.example` to `.env` and provide your secrets:

```bash
cp .env.example .env
```

| Variable | Required | Description | Example |
| :--- | :---: | :--- | :--- |
| `DATABASE_URL` | **Yes** | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/woo_db?schema=public` |
| `ENCRYPTION_KEY` | **Yes** | 64-char (32-byte) hex encryption key | `a1b2c3d4e5f60718...` (generate via `openssl rand -hex 32`) |
| `ADMIN_CHAT_ID` | **Yes** | Telegram Chat ID of the master administrator | `123456789` |
| `PUBLIC_BACKEND_URL` | **Yes** | Public HTTPS base URL for webhooks | `https://bot.example.com` |
| `TELEGRAM_BOT_TOKEN` | **Yes** | Telegram Bot API token from @BotFather | `1234567890:ABCdefGHIjklMNO...` |
| `TELEGRAM_BOT_USERNAME` | No | Bot username without `@` (used for invite links) | `MyStoreManagerBot` |
| `PORT` | No | HTTP server port (default: `3000`) | `3000` |
| `NODE_ENV` | No | Environment mode (`development` \| `production` \| `test`) | `production` |
| `TRUST_PROXY_HOPS` | No | Number of reverse proxy hops to trust (default: `1`) | `1` |
| `DEBUG` | No | Enable verbose debug logging | `false` |
| `SETUP_BOT_METADATA` | No | Sync bot command descriptions on startup | `false` |

---

## Store Management via CLI

Stores are added and managed exclusively via CLI scripts by the system administrator.

### 1. Adding a New Store

Run the store creation CLI interactively or with command-line flags:

```bash
# Interactive mode (prompts for slug, URL, and credentials with hidden input)
npm run store:add

# Or provide parameters directly
npm run store:add -- --name shop-a --url https://shop-a.example.com [--dry-run]
```

When prompted:
1. **Store slug** (unique identifier, alphanumeric and hyphens, max 16 chars, e.g. `shop-a`).
2. **Store URL** (must be `https://`, e.g. `https://shop-a.example.com`).
3. **Consumer Key** (`ck_...`) — input is hidden in terminal.
4. **Consumer Secret** (`cs_...`) — input is hidden in terminal.

The script then:
- Validates credentials by performing a test API call to WooCommerce (`/system_status`).
- Encrypts keys using AES-256-GCM.
- Automatically provisions `order.created` and `order.updated` webhooks in WooCommerce pointing to `PUBLIC_BACKEND_URL/api/webhooks/woocommerce/<storeId>`.
- Saves the store into the database.

### 2. Provisioning & Rotating Webhooks

To re-provision or rotate webhook secrets for an existing store with zero downtime:

```bash
# Preview plan without making changes
npm run store:webhooks -- --store shop-a --dry-run

# Execute rotation
npm run store:webhooks -- --store shop-a
```

The provisioner uses a zero-downtime dual-secret migration:
1. Generates a new random 32-byte secret.
2. Writes dual secrets (`<new>|<old>`) to the database so incoming webhooks signed with either secret are accepted.
3. Creates new webhooks in WooCommerce.
4. Deletes outdated bot webhooks.
5. Finalizes single new secret in the database.

---

## Telegram Bot Commands & Roles

### Master Administrator (`ADMIN_CHAT_ID`)

The administrator has unrestricted access to all active stores and user management commands:

| Command | Description |
| :--- | :--- |
| `/start` | Initializes the admin account with role label "Owner" and displays main menu or store selector. |
| `/invite <store> <label>` | Generates a 60-minute single-use deep-link to invite a manager (e.g. `/invite shop-a Anna`). |
| `/users` | Lists all registered users, their labels, status (`🟢`/`🔴`), and assigned stores. |
| `/revoke <chatId> [store]` | Deactivates a manager completely or revokes membership from a specific store. |
| `/orders [store]` | Lists recent orders across all stores with status badges and page navigation. |
| `/brands [store]` | Browses catalog brands and products with stock and pricing. |
| `/reports [store]` | Displays sales analytics (7 Days, Month, 3M, 6M, YTD, Last Year, Custom Year, Top Customers). |
| `/language` | Switches preferred interface language (`ru`, `en`, `es`). |
| `/help` | Displays usage guide. |

### Store Managers

Managers only receive access via invite deep-links:

| Command | Description |
| :--- | :--- |
| `/start` | Displays main menu or store selector for assigned stores. |
| `/start <CODE>` | Activates an invitation link and grants access to the specified store. |
| `/orders [store]` | Lists recent orders with status badges and page navigation. |
| `/brands [store]` | Browses catalog brands and products with stock and pricing. |
| `/reports [store]` | Displays sales analytics (7 Days, Month, 3M, 6M, YTD, Last Year, Custom Year, Top Customers). |
| `/language` | Switches preferred interface language (`ru`, `en`, `es`). |
| `/help` | Displays usage guide. |
| Text Search | Send any text (product title, SKU, brand) for instant catalog lookup. |

---

## Testing Suite

The repository includes standalone automated test suites verifying critical security boundaries:

```bash
# Run HMAC webhook verification suite (9 tests)
npm run test:hmac

# Run store isolation and access control suite (10 tests)
npm run test:access
```

### Test Coverage

- **`test:hmac`**:
  - Valid primary signature verification.
  - Invalid signature rejection.
  - Constant-time comparison safety against variable-length inputs.
  - Dual-secret rotation verification (both primary and secondary secrets accepted).
  - Empty payload and empty signature edge cases.
- **`test:access`**:
  - Single-store manager isolation.
  - Cross-store boundary enforcement (Member of Store A cannot access Store B).
  - Revoked user rejection (`isActive = false`).
  - Unknown chat rejection.
  - Inactive store rejection.
  - Admin implicit multi-store access.
  - Multi-store manager access across assigned stores.
  - Invite activation preserving existing user profile while attaching additional store membership.

---

## Production Deployment

### Docker & Docker Compose

The production image is built with a multi-stage Dockerfile optimized for low-memory environments (1GB–2GB VPS):

```bash
# Build and start services in background
docker compose up -d --build
```

On startup, `docker-entrypoint.sh` automatically waits for PostgreSQL to become reachable and runs:

```bash
npx prisma migrate deploy
```

### Running CLI Scripts in Docker

To add a store or rotate webhooks inside the running Docker container:

```bash
docker compose exec -it app npm run store:add
docker compose exec -it app npm run store:webhooks -- --store shop-a
```

---

## Project Structure

```
.
├── Dockerfile                     # Multi-stage Docker production build
├── docker-compose.yml             # App + PostgreSQL compose configuration
├── docker-entrypoint.sh           # Container startup & migration runner
├── package.json                   # Dependencies and npm scripts
├── tsconfig.json                  # TypeScript compiler configuration
├── prisma.config.ts               # Prisma CLI configuration
├── prisma/
│   ├── schema.prisma              # Store, ChatUser, StoreMember schema
│   └── migrations/
│       ├── migration_lock.toml    # Lock file for PostgreSQL provider
│       └── 20261008140500_init/   # Baseline clean database migration
├── scripts/
│   ├── add-store.ts               # Interactive store creation CLI
│   ├── setup-webhooks.ts          # Webhook provisioning & rotation CLI
│   ├── test-access.ts             # Access control and store isolation test suite
│   └── test-hmac.ts               # HMAC signature verification test suite
├── bruno/                         # Bruno API collection for health and webhooks
└── src/
    ├── index.ts                   # Express server and bot bootstrapper
    ├── bot/
    │   ├── index.ts               # grammY bot handlers, auth middleware, and notifications
    │   ├── invites.ts             # In-memory single-use invite tokens (60 min TTL, rate limiting)
    │   ├── searchQueryStore.ts    # Short-hash query storage for 64-byte callback constraints
    │   ├── formatters/            # Telegram message and inline keyboard formatters
    │   │   ├── brandFormatter.ts  # Catalog, brand products, and search results
    │   │   ├── orderFormatter.ts  # Detailed order cards, status badges, and actions
    │   │   └── reportFormatter.ts # Financial analytics and Top 10 customer rankings
    │   └── i18n/                  # Trilingual localization (RU, EN, ES)
    ├── config/
    │   ├── env.ts                 # Strict Zod environment variable validation
    │   └── prisma.ts              # Database connection and BigInt serializer
    ├── controllers/
    │   └── webhookController.ts   # WooCommerce webhook receiver with HMAC validation
    ├── middleware/
    │   ├── errorHandler.ts        # Global error handling middleware
    │   └── validate.ts            # Request validation middleware
    ├── routes/
    │   ├── index.ts               # Router mounting /health and /webhooks
    │   └── webhookRoutes.ts       # Route definition for /api/webhooks/woocommerce/:storeId
    ├── services/
    │   ├── storeResolver.ts       # resolveStore with strict membership checks
    │   ├── webhookProvisioner.ts  # WooCommerce REST API webhook provisioning logic
    │   └── woocommerceService.ts  # WooCommerce REST API client wrapper
    └── utils/
        ├── accessControl.ts       # Pure access control logic for stores
        ├── crypto.ts              # AES-256-GCM encryption & decryption
        └── hmac.ts                # Dual HMAC-SHA256 verification
```
