import crypto from 'node:crypto';

export interface PendingInvite {
  hash: string;
  storeId: string;
  storeName: string;
  label: string;
  createdAt: number;
  expiresAt: number;
}

const MAX_ACTIVE_INVITES = 20;
const INVITE_TTL_MS = 60 * 60 * 1000; // 60 minutes
const MAX_FAILED_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// In-memory invite map: sha256(code) -> PendingInvite
const activeInvites = new Map<string, PendingInvite>();

// In-memory rate limiting for invalid attempts: chatId -> timestamp[]
const failedAttempts = new Map<string, number[]>();

/**
 * Clean up expired invites
 */
function purgeExpiredInvites(): void {
  const now = Date.now();
  for (const [hash, invite] of activeInvites.entries()) {
    if (invite.expiresAt <= now) {
      activeInvites.delete(hash);
    }
  }
}

/**
 * Clean up old failed attempts
 */
function purgeOldAttempts(chatIdStr: string): number[] {
  const now = Date.now();
  const timestamps = (failedAttempts.get(chatIdStr) || []).filter(
    (ts) => now - ts < RATE_LIMIT_WINDOW_MS
  );
  if (timestamps.length === 0) {
    failedAttempts.delete(chatIdStr);
  } else {
    failedAttempts.set(chatIdStr, timestamps);
  }
  return timestamps;
}

/**
 * Check if chatId is rate-limited (>5 failed attempts in last 1 hour)
 */
export function isRateLimited(chatId: bigint | number | string): boolean {
  const chatIdStr = String(chatId);
  const attempts = purgeOldAttempts(chatIdStr);
  return attempts.length >= MAX_FAILED_ATTEMPTS;
}

/**
 * Record a failed invitation attempt for rate limiting
 */
export function recordFailedAttempt(chatId: bigint | number | string): void {
  const chatIdStr = String(chatId);
  const attempts = purgeOldAttempts(chatIdStr);
  attempts.push(Date.now());
  failedAttempts.set(chatIdStr, attempts);
}

/**
 * Create a new single-use invite code valid for 60 minutes.
 * Code is generated with 18 random bytes base64url.
 * Only the SHA-256 hash is kept in memory.
 */
export function createInvite(storeId: string, storeName: string, label: string): string {
  purgeExpiredInvites();

  if (activeInvites.size >= MAX_ACTIVE_INVITES) {
    throw new Error('LIMIT_EXCEEDED');
  }

  const code = crypto.randomBytes(18).toString('base64url');
  const hash = crypto.createHash('sha256').update(code).digest('hex');

  const invite: PendingInvite = {
    hash,
    storeId,
    storeName,
    label,
    createdAt: Date.now(),
    expiresAt: Date.now() + INVITE_TTL_MS,
  };

  activeInvites.set(hash, invite);
  return code;
}

/**
 * Consume an invitation code. If valid, burns the code and returns invite metadata.
 * If invalid or rate-limited, records failed attempt and returns null.
 */
export function consumeInvite(code: string, chatId: bigint | number | string): PendingInvite | null {
  purgeExpiredInvites();

  if (isRateLimited(chatId)) {
    return null;
  }

  const hash = crypto.createHash('sha256').update(code.trim()).digest('hex');
  const invite = activeInvites.get(hash);

  if (!invite) {
    recordFailedAttempt(chatId);
    return null;
  }

  if (invite.expiresAt <= Date.now()) {
    activeInvites.delete(hash);
    recordFailedAttempt(chatId);
    return null;
  }

  // Atomically burn the code
  activeInvites.delete(hash);
  return invite;
}
