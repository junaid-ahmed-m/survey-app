/**
 * End-to-end smoke test for the redeem flow.
 * Run the API first (npm run start:prod), then: node test/smoke.e2e.mjs
 */
const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000/api';
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@12345';

let passed = 0;
let failed = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function check(name, condition, extra = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name} ${extra}`);
  }
}

async function call(method, path, { body, token } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

/**
 * The public endpoints are rate limited on purpose, so space the functional
 * calls out and back off once if a previous run already used up the window.
 */
const redeem = async (method, path, body) => {
  await sleep(3500);
  let result = await call(method, path, { body });
  for (let attempt = 0; attempt < 2 && result.status === 429; attempt += 1) {
    console.log('      rate limited, waiting for the window to reset...');
    await sleep(61_000);
    result = await call(method, path, { body });
  }
  return result;
};

async function main() {
  console.log('\n1. Health & admin authentication');
  const health = await call('GET', '/health');
  check('health endpoint responds', health.status === 200, JSON.stringify(health.data));

  const login = await call('POST', '/admin/auth/login', {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  check('admin can sign in', login.status === 200 && Boolean(login.data.accessToken));
  const token = login.data.accessToken;

  const badLogin = await call('POST', '/admin/auth/login', {
    body: { email: ADMIN_EMAIL, password: 'wrong-password' },
  });
  check('wrong password is rejected', badLogin.status === 401);

  const unauthenticated = await call('GET', '/admin/batches');
  check('admin API requires a token', unauthenticated.status === 401);

  console.log('\n2. Locate demo codes');
  const batches = await call('GET', '/admin/batches', { token });
  const demo = batches.data.items.find((b) => b.name === 'Demo Launch Batch');
  check('demo batch exists', Boolean(demo));

  const codes = await call('GET', `/admin/batches/${demo.id}/codes?status=UNUSED&pageSize=5`, { token });
  const listed = codes.data.items[0];
  check('unused codes are available', Boolean(listed), JSON.stringify(codes.data).slice(0, 200));
  check('code listings are masked', listed.code === null && Boolean(listed.masked));

  // Clear text only comes from the audited reveal endpoint.
  const revealed = await call('GET', `/admin/batches/codes/${listed.id}/reveal`, { token });
  check('super admin can reveal a code', revealed.status === 200 && Boolean(revealed.data.code));
  const target = revealed.data;
  console.log(`      using code ${target.code}`);

  console.log('\n3. Public redeem flow');
  const invalid = await redeem('POST', '/public/redeem/verify', { code: 'ZZZZZZZZZZZZZZZ' });
  check(
    'unknown code is rejected with a generic error',
    invalid.status === 404 && invalid.data.code === 'INVALID_CODE',
    JSON.stringify(invalid.data),
  );

  const verified = await redeem('POST', '/public/redeem/verify', { code: target.code });
  check('valid code returns a survey', verified.status === 200 && verified.data.status === 'SURVEY_READY');
  check('native survey has questions', verified.data?.survey?.survey?.questions?.length > 0);
  const sessionToken = verified.data.sessionToken;

  const resumed = await redeem('POST', '/public/redeem/verify', { code: target.code });
  check(
    'rescanning resumes the same session (no second coupon burned)',
    resumed.data.sessionToken === sessionToken,
  );

  const answers = Object.fromEntries(
    verified.data.survey.survey.questions.map((q) => [
      q.id,
      q.type === 'multi_choice'
        ? [q.options?.[0]?.value ?? 'x']
        : q.type === 'single_choice'
          ? (q.options?.[0]?.value ?? 'x')
          : q.type === 'nps'
            ? 9
            : q.type === 'rating'
              ? 5
              : 'Great product',
    ]),
  );

  const completed = await redeem('POST', '/public/redeem/complete', {
    sessionToken,
    email: 'tester@example.com',
    answers,
  });
  check('survey completion issues a coupon', completed.status === 200 && Boolean(completed.data.coupon?.code));
  console.log(`      coupon issued: ${completed.data?.coupon?.code}`);

  const reused = await redeem('POST', '/public/redeem/verify', { code: target.code });
  check(
    'a used code cannot be redeemed twice',
    reused.status === 409 && reused.data.code === 'CODE_ALREADY_USED',
    JSON.stringify(reused.data),
  );

  console.log('\n4. Coupon inventory exhaustion');
  await call('POST', '/admin/coupons/types', {
    token,
    body: { code: 'EMPTYSTOCK', name: 'Out of stock reward' },
  });
  const emptyBatch = await call('POST', '/admin/batches', {
    token,
    body: {
      name: `Exhaustion test ${Date.now()}`,
      surveyType: 'NATIVE',
      surveyId: demo.surveyId,
      couponType: 'EMPTYSTOCK',
      prefix: 'EMPTY',
      codeLength: 10,
      quantity: 2,
    },
  });
  check('batch with an empty coupon type can be created', emptyBatch.status === 201, JSON.stringify(emptyBatch.data).slice(0, 200));

  const emptyCodes = await call('GET', `/admin/batches/${emptyBatch.data.id}/codes`, { token });
  const emptyCode = emptyCodes.data.items[0];
  const emptyRevealed = await call('GET', `/admin/batches/codes/${emptyCode.id}/reveal`, { token });

  const exhausted = await redeem('POST', '/public/redeem/verify', { code: emptyRevealed.data.code });
  check(
    'no coupons left -> user is asked to retry later',
    exhausted.status === 503 && exhausted.data.code === 'COUPONS_EXHAUSTED',
    JSON.stringify(exhausted.data),
  );

  const afterExhaustion = await call('GET', `/admin/batches/${emptyBatch.data.id}/codes`, { token });
  const stillUnused = afterExhaustion.data.items.find((c) => c.id === emptyCode.id);
  check('the code was NOT consumed', stillUnused.status === 'UNUSED', stillUnused.status);

  console.log('\n5. Concurrency / race conditions');
  // Keep the pool healthy so a race is decided by the locking, not by inventory.
  await call('POST', '/admin/coupons/import', {
    token,
    body: { couponTypeCode: demo.couponType, generateCount: 5, generatePrefix: 'RACE' },
  });

  const issuedBefore = (await call('GET', '/admin/coupons?status=ISSUED&pageSize=1', { token })).data.total;

  const raceCodes = await call('GET', `/admin/batches/${demo.id}/codes?status=UNUSED&pageSize=5`, { token });
  const raceCode = raceCodes.data.items[0];
  const raceRevealed = await call('GET', `/admin/batches/codes/${raceCode.id}/reveal`, { token });
  check('a fresh code is available for the race', Boolean(raceRevealed.data?.code));

  // Three simultaneous scans of the same QR (double-tap / StrictMode / two tabs).
  // Wait out the 10/60s redeem window first so the race is not masked by 429s;
  // 3 parallel calls is exactly the 3/5s burst allowance.
  console.log('      waiting for the rate-limit window to clear...');
  await sleep(61_000);
  const scans = await Promise.all(
    [0, 1, 2].map(() => call('POST', '/public/redeem/verify', { code: raceRevealed.data.code })),
  );
  const okScans = scans.filter((r) => r.status === 200);
  const scanTokens = new Set(okScans.map((r) => r.data.sessionToken));
  check(
    'parallel scans of one QR never error',
    scans.every((r) => r.status === 200 || r.status === 429),
    scans.map((r) => r.status).join(','),
  );
  check(
    'parallel scans share a single session (one coupon held)',
    okScans.length > 0 && scanTokens.size === 1,
    `${okScans.length} ok / ${scanTokens.size} token(s)`,
  );

  const raceSession = okScans[0]?.data ?? {};
  const raceAnswers = Object.fromEntries(
    (raceSession?.survey?.survey?.questions ?? []).map((q) => [
      q.id,
      q.type === 'multi_choice'
        ? [q.options?.[0]?.value ?? 'x']
        : q.type === 'single_choice'
          ? (q.options?.[0]?.value ?? 'x')
          : q.type === 'nps'
            ? 9
            : q.type === 'rating'
              ? 5
              : 'Great product',
    ]),
  );

  // Three simultaneous submits of the same session (double-tap on "Get my reward").
  await sleep(6_000);
  const submits = await Promise.all(
    [0, 1, 2].map(() =>
      call('POST', '/public/redeem/complete', {
        body: { sessionToken: raceSession.sessionToken, email: 'race@example.com', answers: raceAnswers },
      }),
    ),
  );
  const winners = submits.filter((r) => r.status === 200);
  check(
    'exactly one parallel submit wins',
    winners.length === 1 && Boolean(winners[0].data.coupon?.code),
    submits.map((r) => r.status).join(','),
  );
  check(
    'losing submits get a clean 409, never a 500',
    submits.every((r) => r.status === 200 || r.status === 409 || r.status === 429) &&
      submits.filter((r) => r.status === 409).every((r) => r.data.code === 'CODE_ALREADY_USED'),
    JSON.stringify(submits.map((r) => [r.status, r.data?.code])),
  );

  const issuedAfter = (await call('GET', '/admin/coupons?status=ISSUED&pageSize=1', { token })).data.total;
  check(
    'only one coupon was issued for the contended code',
    issuedAfter === issuedBefore + 1,
    `${issuedBefore} -> ${issuedAfter}`,
  );

  console.log('\n6. Role based access control');
  const viewerEmail = `viewer.${Date.now()}@example.com`;
  const viewerPassword = 'Viewer@12345';
  const createdViewer = await call('POST', '/admin/users', {
    token,
    body: { email: viewerEmail, name: 'Smoke Viewer', password: viewerPassword, role: 'VIEWER' },
  });
  check('a VIEWER user can be created', createdViewer.status === 201, JSON.stringify(createdViewer.data).slice(0, 200));

  const viewerLogin = await call('POST', '/admin/auth/login', {
    body: { email: viewerEmail, password: viewerPassword },
  });
  const viewerToken = viewerLogin.data.accessToken;
  check(
    'VIEWER has no reveal/export permissions',
    viewerLogin.status === 200 &&
      !viewerLogin.data.user.permissions.includes('codes:reveal') &&
      !viewerLogin.data.user.permissions.includes('emails:reveal'),
    JSON.stringify(viewerLogin.data.user?.permissions),
  );

  const viewerReveal = await call('GET', `/admin/batches/codes/${listed.id}/reveal`, { token: viewerToken });
  check('VIEWER cannot reveal a code', viewerReveal.status === 403, JSON.stringify(viewerReveal.data));

  const viewerExport = await call('GET', `/admin/batches/${demo.id}/export.csv`, { token: viewerToken });
  check('VIEWER cannot export the CSV', viewerExport.status === 403, String(viewerExport.status));

  const viewerResponses = await call('GET', '/admin/responses?reveal=true', { token: viewerToken });
  const firstResponse = viewerResponses.data.items?.[0];
  check(
    'VIEWER only sees masked e-mails even when asking to reveal',
    viewerResponses.status === 200 && Boolean(firstResponse) && firstResponse.email === null && Boolean(firstResponse.maskedEmail),
    JSON.stringify(firstResponse).slice(0, 200),
  );

  const viewerRoles = await call('GET', '/admin/roles', { token: viewerToken });
  check('VIEWER cannot manage access', viewerRoles.status === 403, String(viewerRoles.status));

  const viewerResponsesCsv = await call('GET', '/admin/responses/export.csv', { token: viewerToken });
  check('VIEWER cannot download responses', viewerResponsesCsv.status === 403, String(viewerResponsesCsv.status));

  const issuedCoupons = await call('GET', '/admin/coupons?status=ISSUED&pageSize=5', { token });
  const issued = issuedCoupons.data.items?.[0];
  check(
    'coupon listings mask the code and the issued-to e-mail by default',
    Boolean(issued) &&
      issued.couponCode === null &&
      Boolean(issued.maskedCouponCode) &&
      issued.issuedToEmail === null &&
      Boolean(issued.maskedIssuedToEmail),
    JSON.stringify(issued).slice(0, 200),
  );

  const responsesCsv = await call('GET', '/admin/responses/export.csv', { token });
  check(
    'super admin can download responses as CSV',
    responsesCsv.status === 200 &&
      String(responsesCsv.data).startsWith('"completed_at","batch","survey_type","email"'),
    String(responsesCsv.data).slice(0, 120),
  );

  await call('PATCH', `/admin/users/${createdViewer.data.id}`, { token, body: { isActive: false } });

  const catalog = await call('GET', '/admin/roles/permissions', { token });
  check(
    'permission catalog is grouped',
    catalog.status === 200 && Array.isArray(catalog.data.groups) && catalog.data.groups.length > 0,
    JSON.stringify(catalog.data).slice(0, 200),
  );

  const roleName = `SMOKE_ROLE_${Date.now()}`.slice(0, 32);
  const createdRole = await call('POST', '/admin/roles', {
    token,
    body: { name: roleName, description: 'Temporary smoke role', permissions: ['dashboard:view'] },
  });
  check('a custom role can be created', createdRole.status === 201, JSON.stringify(createdRole.data).slice(0, 200));

  const patchedRole = await call('PATCH', `/admin/roles/${roleName}`, {
    token,
    body: { description: 'Updated', permissions: ['dashboard:view', 'batches:view'] },
  });
  check(
    'a custom role can be edited',
    patchedRole.status === 200 && patchedRole.data.permissions.length === 2,
    JSON.stringify(patchedRole.data).slice(0, 200),
  );

  const superAdminEdit = await call('PATCH', '/admin/roles/SUPER_ADMIN', {
    token,
    body: { permissions: ['dashboard:view'] },
  });
  check('SUPER_ADMIN cannot be downgraded', superAdminEdit.status === 400, String(superAdminEdit.status));

  const removedRole = await call('DELETE', `/admin/roles/${roleName}`, { token });
  check('a custom role can be deleted', removedRole.status === 200, JSON.stringify(removedRole.data));

  console.log('\n7. Rate limiting on the open endpoint');
  const responses = await Promise.all(
    Array.from({ length: 15 }, () => call('POST', '/public/redeem/verify', { code: 'AAAAAAAAAAAAAAA' })),
  );
  check(
    'excess requests are throttled with 429',
    responses.some((r) => r.status === 429),
    `statuses: ${responses.map((r) => r.status).join(',')}`,
  );

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
