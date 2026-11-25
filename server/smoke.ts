import assert from 'node:assert/strict';

function resolveBaseUrl(): string {
  const arg = process.argv.slice(2).find((a) => !a.startsWith('--')) || process.env.SMOKE_URL || '';
  if (!arg) {
    console.error('Usage: npm run smoke -- https://your-deployment-url');
    process.exit(1);
  }
  return arg.replace(/\/+$/, '');
}

async function fetchJson(url: string, init?: RequestInit) {
  const resp = await fetch(url, init);
  const text = await resp.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { resp, text, json };
}

async function main() {
  const baseUrl = resolveBaseUrl();
  console.log(`Running StrangeTheory smoke checks against ${baseUrl}...`);

  // 1. /api/health
  const health = await fetchJson(`${baseUrl}/api/health`);
  assert.equal(health.resp.status, 200, `/api/health expected 200, got ${health.resp.status}: ${health.text}`);
  assert.equal(health.json?.ok, true, '/api/health ok must be true');
  assert.equal(health.json?.db, 'connected', '/api/health db must be connected');
  assert.ok(typeof health.json?.dbLatencyMs === 'number', 'dbLatencyMs must be numeric');
  assert.ok(health.json?.schemaVersion, 'schemaVersion must be present');
  assert.match(health.resp.headers.get('cache-control') || '', /no-store/, '/api/health must not be cached');
  console.log(`  [PASS] /api/health (dbLatencyMs=${health.json.dbLatencyMs}ms, schemaVersion=${health.json.schemaVersion})`);

  // 2. Home page HTML
  const homeResp = await fetch(`${baseUrl}/`);
  const homeHtml = await homeResp.text();
  assert.equal(homeResp.status, 200, `GET / expected 200, got ${homeResp.status}`);
  assert.ok(homeHtml.includes('StrangeTheory'), 'GET / HTML missing StrangeTheory title/brand');
  console.log('  [PASS] GET /');

  // 3. Public posts list -> verify cache headers & discover live experiment + riddle slugs
  const list = await fetchJson(`${baseUrl}/api/posts?limit=20`);
  assert.equal(list.resp.status, 200, `GET /api/posts expected 200, got ${list.resp.status}`);
  assert.match(list.resp.headers.get('vary') || '', /Cookie/i, '/api/posts must vary by Cookie');
  const items = Array.isArray(list.json?.items) ? list.json.items : [];
  assert.ok(items.length > 0, '/api/posts returned 0 published items');

  const experiment = items.find((p: any) => p.type === 'experiment');
  const riddle = items.find((p: any) => p.type === 'riddle');
  assert.ok(experiment?.slug, 'Expected at least one published thought experiment');
  assert.ok(riddle?.slug, 'Expected at least one published riddle');

  // 4. Entry page + API detail
  const expPage = await fetch(`${baseUrl}/post/${experiment.slug}`);
  assert.equal(expPage.status, 200, `GET /post/${experiment.slug} expected 200`);
  const expApi = await fetchJson(`${baseUrl}/api/posts/by-slug/${experiment.slug}`);
  assert.equal(expApi.resp.status, 200, `GET /api/posts/by-slug/${experiment.slug} expected 200`);
  console.log(`  [PASS] Entry page /post/${experiment.slug}`);

  // 5. Riddle page + API spoiler-zero-leak check
  const riddlePage = await fetch(`${baseUrl}/riddle/${riddle.slug}`);
  assert.equal(riddlePage.status, 200, `GET /riddle/${riddle.slug} expected 200`);
  const riddleApi = await fetchJson(`${baseUrl}/api/posts/by-slug/${riddle.slug}`);
  assert.equal(riddleApi.resp.status, 200, `GET /api/posts/by-slug/${riddle.slug} expected 200`);
  if (!riddleApi.json?.post?.riddle?.revealed) {
    assert.equal(riddleApi.json?.post?.riddle_secret, null, 'Unrevealed riddle leaked riddle_secret');
    assert.equal(riddleApi.json?.post?.riddle?.hints?.length || 0, 0, 'Unrevealed riddle leaked hints');
  }
  console.log(`  [PASS] Riddle page /riddle/${riddle.slug} (spoiler check clean)`);

  // 6. Search endpoint
  const search = await fetchJson(`${baseUrl}/api/search?q=What`);
  assert.equal(search.resp.status, 200, `GET /api/search expected 200, got ${search.resp.status}`);
  assert.ok(Array.isArray(search.json?.items), '/api/search items must be an array');
  for (const item of search.json.items) {
    if (item.type === 'riddle' && !item.riddle?.revealed) {
      assert.equal(item.riddle_secret, null, `Search leaked riddle_secret for ${item.slug}`);
    }
  }
  console.log(`  [PASS] GET /api/search (${search.json.items.length} results)`);

  // 7. Validation error shape check on signup
  const badSignup = await fetchJson(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'not-an-email', username: 'x', display_name: '', password: 'short' }),
  });
  assert.equal(badSignup.resp.status, 400, 'Invalid signup expected 400');
  assert.equal(badSignup.json?.code, 'VALIDATION_ERROR');
  assert.ok(typeof badSignup.json?.message === 'string' && badSignup.json.message.length > 0);
  assert.ok(Array.isArray(badSignup.json?.fields) && badSignup.json.fields.length > 0);
  console.log('  [PASS] Validation error shape on POST /api/auth/signup');

  // 8. Protected routes reject unauthenticated access cleanly
  const dash = await fetchJson(`${baseUrl}/api/dashboard`);
  assert.equal(dash.resp.status, 401, `Unauthenticated /api/dashboard expected 401, got ${dash.resp.status}`);
  assert.equal(dash.json?.code, 'UNAUTHORIZED');
  assert.match(dash.resp.headers.get('cache-control') || '', /no-store/, 'Protected route must not be cached');

  const mod = await fetchJson(`${baseUrl}/api/admin/moderation`);
  assert.equal(mod.resp.status, 403, `Unauthenticated /api/admin/moderation expected 403, got ${mod.resp.status}`);
  assert.equal(mod.json?.code, 'FORBIDDEN');
  assert.match(mod.resp.headers.get('cache-control') || '', /no-store/, 'Moderation route must not be cached');
  console.log('  [PASS] Protected routes (/api/dashboard -> 401, /api/admin/moderation -> 403)');

  // 9. Realtime polling endpoints, ETag/304, leaderboard & weekly challenge
  const expPoll = await fetchJson(`${baseUrl}/api/realtime/posts/${experiment.id}/comments?lens=ripples`);
  assert.equal(expPoll.resp.status, 200, 'Realtime comments poll expected 200');
  const expEtag = expPoll.resp.headers.get('etag');
  assert.ok(expEtag, 'Realtime comments poll must return ETag');
  const expPoll304 = await fetch(`${baseUrl}/api/realtime/posts/${experiment.id}/comments?lens=ripples`, {
    headers: { 'if-none-match': expEtag! },
  });
  assert.equal(expPoll304.status, 304, 'Matching If-None-Match expected 304');

  const ridPoll = await fetchJson(`${baseUrl}/api/realtime/riddles/${riddle.id}`);
  assert.equal(ridPoll.resp.status, 200, 'Realtime riddle status poll expected 200');
  assert.equal('answer_text' in (ridPoll.json || {}), false, 'Riddle status poll must not expose answer_text');
  assert.equal('explanation' in (ridPoll.json || {}), false, 'Riddle status poll must not expose explanation');

  const lb = await fetchJson(`${baseUrl}/api/leaderboard?window=all`);
  assert.equal(lb.resp.status, 200, 'Leaderboard expected 200');
  assert.ok(Array.isArray(lb.json?.leaders), 'Leaderboard leaders must be an array');

  const weekly = await fetchJson(`${baseUrl}/api/weekly-riddle`);
  assert.equal(weekly.resp.status, 200, 'Weekly riddle expected 200');
  console.log('  [PASS] Realtime polling endpoints, ETag/304, leaderboard & weekly challenge');

  console.log('All smoke checks passed.');
}

main().catch((err) => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
