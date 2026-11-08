-- CreateTable
CREATE TABLE "sale_drafts" (
    "telegram_id" BIGINT NOT NULL,
    "data" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sale_drafts_pkey" PRIMARY KEY ("telegram_id")
);

