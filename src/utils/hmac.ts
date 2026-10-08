import crypto from 'node:crypto';

/**
 * Verify WooCommerce webhook HMAC-SHA256 signature using raw request body bytes.
 * Supports comma-separated dual secrets (newSecret,oldSecret) during rotation without timing leaks.
 */
export function verifyWebhookHmac(
  rawBody: Buffer | string,
  signature: string,
  secrets: string | string[]
): boolean {
  if (!signature) return false;

  const secretList = Array.isArray(secrets)
    ? secrets
    : secrets
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

  if (secretList.length === 0) return false;

  const bodyBuf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
  const sigBuf = Buffer.from(signature, 'utf8');
  let isValid = false;

  for (const secret of secretList) {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(bodyBuf)
      .digest('base64');

    const expBuf = Buffer.from(expected, 'utf8');

    if (sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf)) {
      isValid = true;
    }
  }

  return isValid;
}
