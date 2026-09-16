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
  const target = codes.data.items[0];
  check('unused codes are available', Boolean(target), JSON.stringify(codes.data).slice(0, 200));
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

  const exhausted = await redeem('POST', '/public/redeem/verify', { code: emptyCode.code });
  check(
    'no coupons left -> user is asked to retry later',
    exhausted.status === 503 && exhausted.data.code === 'COUPONS_EXHAUSTED',
    JSON.stringify(exhausted.data),
  );

  const afterExhaustion = await call('GET', `/admin/batches/${emptyBatch.data.id}/codes`, { token });
  const stillUnused = afterExhaustion.data.items.find((c) => c.id === emptyCode.id);
  check('the code was NOT consumed', stillUnused.status === 'UNUSED', stillUnused.status);

  console.log('\n5. Rate limiting on the open endpoint');
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
