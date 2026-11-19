-- AlterTable: Add optional per-store WordPress brand-sale credentials (AES-256-GCM encrypted)
ALTER TABLE "stores"
ADD COLUMN "wp_user_encrypted" TEXT,
ADD COLUMN "wp_app_password_encrypted" TEXT;

-- AlterTable: Scope sale drafts per (telegram_id, store_key) for multi-store isolation
-- Clear ephemeral drafts (<24h TTL) before updating primary key so migration is always safe
DELETE FROM "sale_drafts";

ALTER TABLE "sale_drafts"
DROP CONSTRAINT "sale_drafts_pkey",
ADD COLUMN "store_key" VARCHAR(64) NOT NULL,
ADD CONSTRAINT "sale_drafts_pkey" PRIMARY KEY ("telegram_id", "store_key");
