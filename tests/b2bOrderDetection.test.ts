import test from 'node:test';
import assert from 'node:assert/strict';
import { isB2BOrder } from '../src/bot/formatters/orderFormatter.js';
import type { WooOrder } from '../src/services/woocommerceService.js';

function makeOrder(overrides: Partial<WooOrder>): WooOrder {
  return {
    id: 1,
    status: 'processing',
    total: '100.00',
    currency: 'EUR',
    currency_symbol: '€',
    date_created: '2026-11-08T10:00:00',
    payment_method: 'stripe',
    payment_method_title: 'Credit Card',
    billing: {
      first_name: 'John',
      last_name: 'Doe',
      email: 'john@example.com',
      phone: '+34600000000',
      company: '',
      city: 'Madrid',
      country: 'ES',
    },
    line_items: [],
    meta_data: [],
    ...overrides,
  };
}

test('isB2BOrder returns true when b2bking_is_b2b_order is "yes"', () => {
  const b2bOrder = makeOrder({
    billing: {
      first_name: 'Wholesale',
      last_name: 'Buyer',
      email: 'wholesale@example.com',
      phone: '+34600000000',
      company: 'X1234567A',
      city: 'Madrid',
      country: 'ES',
    },
    meta_data: [{ key: 'b2bking_is_b2b_order', value: 'yes' }],
  });
  assert.equal(isB2BOrder(b2bOrder), true);
});

test('isB2BOrder returns false when b2bking_is_b2b_order is "no", even with company filled', () => {
  const retailOrderWithCompany = makeOrder({
    billing: {
      first_name: 'Retail',
      last_name: 'Buyer',
      email: 'retail@example.com',
      phone: '+34600000001',
      company: 'Some Solutions, S.L.',
      city: 'Madrid',
      country: 'ES',
    },
    meta_data: [{ key: 'b2bking_is_b2b_order', value: 'no' }],
  });
  assert.equal(isB2BOrder(retailOrderWithCompany), false);
});

test('isB2BOrder returns false when b2bking_is_b2b_order is missing', () => {
  const orderWithoutMeta = makeOrder({
    billing: {
      first_name: 'Regular',
      last_name: 'Customer',
      email: 'regular@example.com',
      phone: '+34600000002',
      company: 'Corporate Name Inc.',
      city: 'Barcelona',
      country: 'ES',
    },
    meta_data: [],
  });
  assert.equal(isB2BOrder(orderWithoutMeta), false);
});
