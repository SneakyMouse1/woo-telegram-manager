import crypto from 'node:crypto';
import { verifyWebhookHmac } from '../src/utils/hmac.js';

function computeSignature(payload: string | Buffer, secret: string): string {
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  return crypto.createHmac('sha256', secret).update(buf).digest('base64');
}

function runTests() {
  console.log('🧪 Starting HMAC verification test suite...\n');
  let passed = 0;
  let total = 0;

  function assert(name: string, condition: boolean) {
    total++;
    if (condition) {
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${name}`);
    }
  }

  const secret1 = 'secret_primary_abc123';
  const secret2 = 'secret_secondary_xyz789';
  const dualSecretString = `${secret1},${secret2}`;

  const samplePayload = JSON.stringify({ id: 101, status: 'processing', total: '125.00' });
  const sampleBuffer = Buffer.from(samplePayload, 'utf8');

  // Test 1: Valid signature with primary secret
  const validSig1 = computeSignature(sampleBuffer, secret1);
  assert(
    '1. Valid signature with primary secret should pass',
    verifyWebhookHmac(sampleBuffer, validSig1, secret1) === true
  );

  // Test 2: Invalid signature (same length)
  const invalidSig = computeSignature(sampleBuffer, 'wrong_secret_123456');
  assert(
    '2. Invalid signature with incorrect secret should fail',
    verifyWebhookHmac(sampleBuffer, invalidSig, secret1) === false
  );

  // Test 3: Signature of different length (e.g. malformed or tampered)
  const shortSig = 'short_invalid_signature';
  assert(
    '3. Signature of different length should fail without error',
    verifyWebhookHmac(sampleBuffer, shortSig, secret1) === false
  );

  // Test 4: Secret rotation - signature from secondary (old) secret must be accepted with dual secrets
  const validSig2 = computeSignature(sampleBuffer, secret2);
  assert(
    '4. Dual-secret rotation: signature generated with secondary secret passes',
    verifyWebhookHmac(sampleBuffer, validSig2, dualSecretString) === true
  );

  // Test 4b: Dual-secret rotation: signature generated with primary secret also passes
  assert(
    '4b. Dual-secret rotation: signature generated with primary secret passes',
    verifyWebhookHmac(sampleBuffer, validSig1, dualSecretString) === true
  );

  // Test 4c: Dual-secret rotation: signature with third unknown secret fails
  assert(
    '4c. Dual-secret rotation: signature with unknown secret fails',
    verifyWebhookHmac(sampleBuffer, invalidSig, dualSecretString) === false
  );

  // Test 5: Empty body with valid signature
  const emptyBody = Buffer.from('');
  const emptyBodySig = computeSignature(emptyBody, secret1);
  assert(
    '5. Empty body with valid signature should pass',
    verifyWebhookHmac(emptyBody, emptyBodySig, secret1) === true
  );

  // Test 6: Empty body with invalid signature
  assert(
    '6. Empty body with invalid signature should fail',
    verifyWebhookHmac(emptyBody, validSig1, secret1) === false
  );

  // Test 7: Empty signature
  assert(
    '7. Empty signature string should fail',
    verifyWebhookHmac(sampleBuffer, '', secret1) === false
  );

  console.log(`\n📊 Tests completed: ${passed}/${total} passed.`);

  if (passed !== total) {
    process.exit(1);
  }
}

runTests();
