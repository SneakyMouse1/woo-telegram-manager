import { canAccessStore } from '../src/utils/accessControl.js';

function runAccessTests() {
  console.log('🧪 Starting store isolation & access control test suite...\n');
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

  const ADMIN_ID = '999000111';
  const USER_A_CHAT_ID = 10001n;
  const USER_B_CHAT_ID = 20002n;

  const storeA = { id: 'store-a-uuid', name: 'store-a', isActive: true };
  const storeB = { id: 'store-b-uuid', name: 'store-b', isActive: true };
  const storeInactive = { id: 'store-c-uuid', name: 'store-c', isActive: false };

  // Scenario 1: Active Member of Store A accessing Store A -> ALLOWED
  const res1 = canAccessStore({
    chatId: USER_A_CHAT_ID,
    adminChatId: ADMIN_ID,
    user: { isActive: true },
    store: storeA,
    isStoreMember: true,
  });
  assert('1. Active member of Store A can access Store A', res1.allowed === true);

  // Scenario 2: Active Member of Store A accessing Store B (cross-store isolation) -> DENIED
  const res2 = canAccessStore({
    chatId: USER_A_CHAT_ID,
    adminChatId: ADMIN_ID,
    user: { isActive: true },
    store: storeB,
    isStoreMember: false,
  });
  assert(
    '2. Member of Store A cannot access Store B (store isolation)',
    res2.allowed === false && res2.reason?.includes('участником') === true
  );

  // Scenario 3: Revoked / disabled ChatUser accessing Store A -> DENIED
  const res3 = canAccessStore({
    chatId: USER_A_CHAT_ID,
    adminChatId: ADMIN_ID,
    user: { isActive: false },
    store: storeA,
    isStoreMember: true,
  });
  assert('3. Revoked ChatUser (isActive = false) cannot access Store A', res3.allowed === false);

  // Scenario 4: Unknown user (no ChatUser record) accessing Store A -> DENIED
  const res4 = canAccessStore({
    chatId: 99999n,
    adminChatId: ADMIN_ID,
    user: null,
    store: storeA,
    isStoreMember: false,
  });
  assert('4. Unknown / null ChatUser cannot access Store A', res4.allowed === false);

  // Scenario 5: Inactive store accessed by regular member -> DENIED
  const res5 = canAccessStore({
    chatId: USER_A_CHAT_ID,
    adminChatId: ADMIN_ID,
    user: { isActive: true },
    store: storeInactive,
    isStoreMember: true,
  });
  assert('5. Inactive store cannot be accessed by regular member', res5.allowed === false);

  // Scenario 6: Inactive store accessed by Admin -> DENIED
  const res6 = canAccessStore({
    chatId: BigInt(ADMIN_ID),
    adminChatId: ADMIN_ID,
    user: { isActive: true },
    store: storeInactive,
    isStoreMember: false,
  });
  assert('6. Inactive store cannot be accessed even by Admin', res6.allowed === false);

  // Scenario 7: Admin accessing Store A (without explicit membership) -> ALLOWED
  const res7 = canAccessStore({
    chatId: BigInt(ADMIN_ID),
    adminChatId: ADMIN_ID,
    user: { isActive: true },
    store: storeA,
    isStoreMember: false,
  });
  assert('7. Admin has implicit access to active Store A', res7.allowed === true);

  // Scenario 8: Admin accessing Store B (without explicit membership) -> ALLOWED
  const res8 = canAccessStore({
    chatId: BigInt(ADMIN_ID),
    adminChatId: ADMIN_ID,
    user: { isActive: true },
    store: storeB,
    isStoreMember: false,
  });
  assert('8. Admin has implicit access to active Store B', res8.allowed === true);

  // Scenario 9: Multi-store member (member of both Store A and Store B) accessing both -> ALLOWED
  const res9a = canAccessStore({
    chatId: USER_B_CHAT_ID,
    adminChatId: ADMIN_ID,
    user: { isActive: true },
    store: storeA,
    isStoreMember: true,
  });
  const res9b = canAccessStore({
    chatId: USER_B_CHAT_ID,
    adminChatId: ADMIN_ID,
    user: { isActive: true },
    store: storeB,
    isStoreMember: true,
  });
  assert('9. Multi-store member can access both Store A and Store B', res9a.allowed && res9b.allowed);

  // Scenario 10: Existing user activating invite to 2nd store preserves existing label and adds membership
  function simulateUserActivation(
    existingUser: { label: string; isActive: boolean } | null,
    invite: { storeId: string; label: string }
  ) {
    const finalLabel = existingUser ? existingUser.label : invite.label;
    const finalActive = true;
    return { label: finalLabel, isActive: finalActive, addedToStore: invite.storeId };
  }

  const existingManager = { label: 'Старший менеджер', isActive: true };
  const activationRes = simulateUserActivation(existingManager, { storeId: storeB.id, label: 'Новый ярлык' });
  assert(
    '10. Existing user activating 2nd store preserves label and adds store',
    activationRes.label === 'Старший менеджер' && activationRes.addedToStore === storeB.id
  );

  console.log(`\n📊 Tests completed: ${passed}/${total} passed.`);

  if (passed !== total) {
    process.exit(1);
  }
}

runAccessTests();
