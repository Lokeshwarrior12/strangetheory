import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server';
import { closeDb, ensureDbReady, executeSql, queryOne } from './db';

interface HttpSession {
  cookies: Map<string, string>;
  request: (method: string, urlPath: string, body?: unknown, extraHeaders?: Record<string, string>) => Promise<{
    status: number;
    data: Record<string, any>;
    headers: Headers;
    text: string;
  }>;
}

function createSession(baseUrl: string): HttpSession {
  const cookies = new Map<string, string>();
  return {
    cookies,
    async request(method, urlPath, body, extraHeaders = {}) {
      const headers: Record<string, string> = { ...extraHeaders };
      if (body !== undefined) {
        headers['content-type'] = 'application/json';
      }
      if (cookies.size > 0) {
        headers['cookie'] = Array.from(cookies.entries())
          .map(([k, v]) => `${k}=${v}`)
          .join('; ');
      }
      const csrf = cookies.get('st_csrf');
      if (csrf && !['GET', 'HEAD', 'OPTIONS'].includes(method) && !('x-csrf-token' in headers)) {
        headers['x-csrf-token'] = csrf;
      }

      const resp = await fetch(`${baseUrl}${urlPath}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      const setCookies =
        typeof (resp.headers as any).getSetCookie === 'function'
          ? ((resp.headers as any).getSetCookie() as string[])
          : [];
      for (const sc of setCookies) {
        const pair = sc.split(';')[0];
        const eqIdx = pair.indexOf('=');
        if (eqIdx > 0) {
          const name = pair.slice(0, eqIdx).trim();
          const val = pair.slice(eqIdx + 1).trim();
          if (!val || sc.toLowerCase().includes('max-age=0')) {
            cookies.delete(name);
          } else {
            cookies.set(name, val);
          }
        }
      }

      const text = await resp.text();
      let data: Record<string, any> = {};
      try {
        data = text ? (JSON.parse(text) as Record<string, any>) : {};
      } catch {
        data = { raw: text };
      }
      return { status: resp.status, data, headers: resp.headers, text };
    },
  };
}

async function withServer(
  fn: (baseUrl: string) => Promise<void>,
  envOverrides: Record<string, string | undefined> = {}
) {
  const prevEnv: Record<string, string | undefined> = {
    STRANGETHEORY_NO_LISTEN: process.env.STRANGETHEORY_NO_LISTEN,
    STRANGETHEORY_DB_MEMORY: process.env.STRANGETHEORY_DB_MEMORY,
    STRANGETHEORY_SKIP_SEED: process.env.STRANGETHEORY_SKIP_SEED,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    CRON_SECRET: process.env.CRON_SECRET,
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
  };

  process.env.STRANGETHEORY_NO_LISTEN = '1';
  process.env.STRANGETHEORY_DB_MEMORY = '1';
  delete process.env.STRANGETHEORY_SKIP_SEED;
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  await closeDb();
  await ensureDbReady();

  const app = createApp();
  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    await fn(baseUrl);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeDb();
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function signupAndVerify(
  baseUrl: string,
  opts: { email: string; username: string; display_name: string; password?: string; ageHours?: number }
): Promise<HttpSession> {
  const session = createSession(baseUrl);
  await session.request('GET', '/api/auth/me');
  const signup = await session.request('POST', '/api/auth/signup', {
    email: opts.email,
    username: opts.username,
    display_name: opts.display_name,
    password: opts.password || 'Velvet-Photon-942!',
  });
  assert.equal(signup.status, 201, `Signup failed: ${JSON.stringify(signup.data)}`);
  const previewUrl = String(signup.data.verification_preview_url || '');
  const token = new URL(previewUrl).searchParams.get('token');
  assert.ok(token, 'Expected verification token preview URL in non-prod');
  const verify = await session.request('POST', '/api/auth/verify-email', { token });
  assert.equal(verify.status, 200);
  if (opts.ageHours && opts.ageHours > 24) {
    const oldIso = new Date(Date.now() - opts.ageHours * 3600_000).toISOString();
    await executeSql('UPDATE users SET created_at = $1 WHERE id = $2', [oldIso, signup.data.user.id]);
  }
  return session;
}

test('Auth security: >=10 char password rule, common password block, email verification gate on publish, and password reset flow', async () => {
  await withServer(async (baseUrl) => {
    const s = createSession(baseUrl);
    await s.request('GET', '/api/auth/me');

    // Short password rejected
    const shortRes = await s.request('POST', '/api/auth/signup', {
      email: 'short@example.com',
      username: 'short_pw',
      display_name: 'Short Pw',
      password: 'Short99!',
    });
    assert.equal(shortRes.status, 400);

    // Common password rejected even if >=10 chars
    const commonRes = await s.request('POST', '/api/auth/signup', {
      email: 'common@example.com',
      username: 'common_pw',
      display_name: 'Common Pw',
      password: 'password1234',
    });
    assert.equal(commonRes.status, 400);

    // Valid signup starts unverified
    const signup = await s.request('POST', '/api/auth/signup', {
      email: 'gate@example.com',
      username: 'gate_tester',
      display_name: 'Gate Tester',
      password: 'Amber-Synapse-713!',
    });
    assert.equal(signup.status, 201);
    assert.equal(signup.data.user.email_verified, false);

    // Unverified user can save draft, CANNOT publish
    const draft = await s.request('POST', '/api/posts', {
      type: 'experiment',
      title: 'Verification Gate Experiment',
      intro: 'Drafting before verifying email should succeed cleanly.',
      category_ids: ['cat-physics'],
      ai_assisted: false,
      body_json: { premise: '<p>Unverified premise.</p>', ripples: '', breaks_down: '' },
    });
    assert.equal(draft.status, 201);

    const blockedPub = await s.request('POST', `/api/posts/${draft.data.post.id}/publish`, {});
    assert.equal(blockedPub.status, 403);
    assert.equal(blockedPub.data.code, 'EMAIL_NOT_VERIFIED');

    // Resend verification generates fresh token and invalidates old token
    const resend = await s.request('POST', '/api/auth/resend-verification', {});
    assert.equal(resend.status, 200);
    const freshToken = new URL(String(resend.data.preview_url)).searchParams.get('token')!;
    const oldToken = new URL(String(signup.data.verification_preview_url)).searchParams.get('token')!;

    assert.equal((await s.request('POST', '/api/auth/verify-email', { token: oldToken })).status, 400);
    const verified = await s.request('POST', '/api/auth/verify-email', { token: freshToken });
    assert.equal(verified.status, 200);
    assert.equal(verified.data.user.email_verified, true);

    // Now publish succeeds!
    const okPub = await s.request('POST', `/api/posts/${draft.data.post.id}/publish`, {});
    assert.equal(okPub.status, 200);
    assert.equal(okPub.data.post.status, 'published');

    // Password reset flow
    const resetReq = await s.request('POST', '/api/auth/reset-password', { email: 'gate@example.com' });
    assert.equal(resetReq.status, 200);
    const resetToken = new URL(String(resetReq.data.preview_url)).searchParams.get('token')!;
    const confirmReset = await s.request('POST', '/api/auth/reset-password/confirm', {
      token: resetToken,
      password: 'Cortex-Horizon-884!',
    });
    assert.equal(confirmReset.status, 200);

    // Token cannot be reused
    assert.equal(
      (await s.request('POST', '/api/auth/reset-password/confirm', { token: resetToken, password: 'Another-Password-999!' })).status,
      400
    );

    // Old password rejected, new password works
    assert.equal((await s.request('POST', '/api/auth/login', { emailOrUsername: 'gate_tester', password: 'Amber-Synapse-713!' })).status, 401);
    assert.equal((await s.request('POST', '/api/auth/login', { emailOrUsername: 'gate_tester', password: 'Cortex-Horizon-884!' })).status, 200);

    // Rate limit on repeated failed sign-in attempts (1 failed attempt already occurred above; 9 more reach 10/15min limit, 11th hits 429)
    const brute = createSession(baseUrl);
    for (let i = 0; i < 9; i++) {
      const r = await brute.request('POST', '/api/auth/login', { emailOrUsername: 'gate_tester', password: 'wrong-password-attempt' });
      assert.equal(r.status, 401);
    }
    const locked = await brute.request('POST', '/api/auth/login', { emailOrUsername: 'gate_tester', password: 'wrong-password-attempt' });
    assert.equal(locked.status, 429);
    assert.equal(locked.data.code, 'RATE_LIMITED');
  });
});

test('Riddle answer-leak protection: never exposes riddle_secret, unrevealed hints, or likely_correct to non-authors until reveal', async () => {
  await withServer(async (baseUrl) => {
    const visitor = createSession(baseUrl);
    const author = await signupAndVerify(baseUrl, {
      email: 'riddler@example.com',
      username: 'riddler_author',
      display_name: 'Riddler Author',
      ageHours: 48,
    });
    const solver = await signupAndVerify(baseUrl, {
      email: 'solver@example.com',
      username: 'sharp_solver',
      display_name: 'Sharp Solver',
      ageHours: 48,
    });

    const createRes = await author.request('POST', '/api/posts', {
      type: 'riddle',
      title: 'The Invisible Key Vault',
      intro: 'A vault opens only when nobody tries to open it.',
      category_ids: ['cat-language'],
      ai_assisted: false,
      riddle: {
        difficulty: 'Hard',
        riddle_type: 'Logic',
        question: '<p>Three sealed boxes sit on a bench. Only one statement is true. Which box holds the key?</p>',
        hints: ['Hint One', 'Hint Two', 'Hint Three'],
        answer_text: 'SECRET_BOX_TWO',
        answer_keywords: ['box two', 'second box'],
        explanation: 'CONFIDENTIAL_EXPLANATION_TEXT',
        reveal_mode: 'author',
        reveal_days: 7,
      },
    });
    assert.equal(createRes.status, 201);
    const postId = createRes.data.post.id;
    const slug = createRes.data.post.slug;
    assert.equal(createRes.data.post.riddle_secret.answer_text, 'SECRET_BOX_TWO');

    const pubRes = await author.request('POST', `/api/posts/${postId}/publish`, {});
    assert.equal(pubRes.status, 200);

    // Visitor fetches the riddle: no secret, no hints, answers locked
    const visGet = await visitor.request('GET', `/api/posts/by-slug/${slug}`);
    assert.equal(visGet.status, 200);
    assert.equal(visGet.data.post.riddle_secret, null);
    assert.deepEqual(visGet.data.post.riddle.hints, []);
    assert.equal(visGet.text.includes('SECRET_BOX_TWO'), false);
    assert.equal(visGet.text.includes('CONFIDENTIAL_EXPLANATION_TEXT'), false);

    // Unauthenticated comment curtain returns locked: true and 0 items
    const visComments = await visitor.request('GET', `/api/posts/${postId}/comments?lens=answer`);
    assert.equal(visComments.status, 200);
    assert.equal(visComments.data.locked, true);
    assert.equal(visComments.data.items.length, 0);

    // Solver reveals 1 hint, submits matching keyword answer
    const hintRes = await solver.request('POST', `/api/riddles/${postId}/hint`, {});
    assert.equal(hintRes.status, 200);
    assert.deepEqual(hintRes.data.revealed_hints, ['Hint One']);

    const solverAfterHint = await solver.request('GET', `/api/posts/by-slug/${slug}`);
    assert.equal(solverAfterHint.data.post.riddle_secret, null);
    assert.deepEqual(solverAfterHint.data.post.riddle.hints, ['Hint One']);
    assert.equal(solverAfterHint.text.includes('Hint Two'), false);

    const submitAns = await solver.request('POST', `/api/posts/${postId}/comments`, {
      lens: 'answer',
      body: 'I think it is box two because of inversion.',
    });
    assert.equal(submitAns.status, 201);
    assert.equal(submitAns.data.comment.likely_correct, false);

    const solverAfterAns = await solver.request('GET', `/api/posts/by-slug/${slug}`);
    assert.equal(solverAfterAns.data.post.riddle_secret, null);

    // Author sees likely_correct = true and marks accepted (+14 Synapse = 10 - 1 hint + 5 first solver)
    const authorComments = await author.request('GET', `/api/posts/${postId}/comments?lens=answer`);
    assert.equal(authorComments.status, 200);
    assert.equal(authorComments.data.items[0].likely_correct, true);

    const solverBefore = (await solver.request('GET', '/api/auth/me')).data.user.synapse_total;
    const acceptRes = await author.request('POST', `/api/riddles/${postId}/accept/${submitAns.data.comment.id}`, {});
    assert.equal(acceptRes.status, 200);
    const solverAfter = (await solver.request('GET', '/api/auth/me')).data.user.synapse_total;
    assert.equal(solverAfter, solverBefore + 14);

    // Non-author cannot reveal early
    assert.equal((await solver.request('POST', `/api/riddles/${postId}/reveal`, {})).status, 403);

    // Author reveals official explanation -> visitor sees riddle_secret
    assert.equal((await author.request('POST', `/api/riddles/${postId}/reveal`, {})).status, 200);
    const visAfterReveal = await visitor.request('GET', `/api/posts/by-slug/${slug}`);
    assert.equal(visAfterReveal.data.post.riddle_secret.answer_text, 'SECRET_BOX_TWO');
    assert.ok(visAfterReveal.data.post.riddle_secret.explanation.includes('CONFIDENTIAL_EXPLANATION_TEXT'));
  });
});

test('Rate limits & new account protections: 2/day publish cap, 5/hr new-account comment cap, and external link block', async () => {
  await withServer(async (baseUrl) => {
    const newcomer = await signupAndVerify(baseUrl, {
      email: 'newbie@example.com',
      username: 'fresh_thinker',
      display_name: 'Fresh Thinker',
    });

    // New account cannot publish external links
    const badDraft = await newcomer.request('POST', '/api/posts', {
      type: 'experiment',
      title: 'Link Spam Draft',
      intro: 'Testing link blocking for fresh accounts.',
      category_ids: ['cat-physics'],
      ai_assisted: false,
      body_json: {
        premise: '<p>Check https://spam.example.org right now.</p>',
        ripples: '<p>Immediate blocks.</p>',
        breaks_down: '<p>Boundary holds.</p>',
      },
    });
    assert.equal(badDraft.status, 201);
    const badPub = await newcomer.request('POST', `/api/posts/${badDraft.data.post.id}/publish`, {});
    assert.equal(badPub.status, 403);
    assert.equal(badPub.data.code, 'NEW_ACCOUNT_LINK_RESTRICTED');

    // New account cannot comment with external links
    const badComment = await newcomer.request('POST', '/api/posts/post-exp-1/comments', {
      lens: 'ripples',
      body: 'Visit https://spam.example.org for details.',
    });
    assert.equal(badComment.status, 403);
    assert.equal(badComment.data.code, 'NEW_ACCOUNT_LINK_RESTRICTED');

    // New account hits 5/hr comment cap on 6th comment
    for (let i = 1; i <= 5; i++) {
      const c = await newcomer.request('POST', '/api/posts/post-exp-1/comments', {
        lens: 'ripples',
        body: `Constructive ripple note number ${i} without links.`,
      });
      assert.equal(c.status, 201);
    }
    const sixthComment = await newcomer.request('POST', '/api/posts/post-exp-1/comments', {
      lens: 'ripples',
      body: 'Sixth comment should be rate limited.',
    });
    assert.equal(sixthComment.status, 429);
    assert.equal(sixthComment.data.code, 'RATE_LIMITED');

    // Daily publish limit of 2 per 24h
    for (let p = 1; p <= 2; p++) {
      const d = await newcomer.request('POST', '/api/posts', {
        type: 'experiment',
        title: `Valid Experiment ${p}`,
        intro: 'Clean thought experiment intro without external URLs.',
        category_ids: ['cat-physics'],
        ai_assisted: false,
        body_json: {
          premise: '<p>Pure physical premise.</p>',
          ripples: '<p>First and second order ripples.</p>',
          breaks_down: '<p>Conservation boundary.</p>',
        },
      });
      assert.equal(d.status, 201);
      const pub = await newcomer.request('POST', `/api/posts/${d.data.post.id}/publish`, {});
      assert.equal(pub.status, 200);
    }
    const thirdDraft = await newcomer.request('POST', '/api/posts', {
      type: 'experiment',
      title: 'Third Experiment Same Day',
      intro: 'Should hit 2/day publish focus limit.',
      category_ids: ['cat-physics'],
      ai_assisted: false,
      body_json: {
        premise: '<p>Premise three.</p>',
        ripples: '<p>Ripples three.</p>',
        breaks_down: '<p>Breaks three.</p>',
      },
    });
    const thirdPub = await newcomer.request('POST', `/api/posts/${thirdDraft.data.post.id}/publish`, {});
    assert.equal(thirdPub.status, 429);
    assert.equal(thirdPub.data.code, 'RATE_LIMITED');
  });
});

test('Permissions, RBAC, self-reaction ban, CSRF protection, and unhide block', async () => {
  await withServer(
    async (baseUrl) => {
      const visitor = createSession(baseUrl);
      const member = await signupAndVerify(baseUrl, {
        email: 'member1@example.com',
        username: 'member_one',
        display_name: 'Member One',
        ageHours: 48,
      });
      const modCandidate = await signupAndVerify(baseUrl, {
        email: 'mod@example.com',
        username: 'mod_user',
        display_name: 'Mod User',
        ageHours: 48,
      });
      const admin = createSession(baseUrl);
      await admin.request('GET', '/api/auth/me');
      const adminLogin = await admin.request('POST', '/api/auth/login', {
        emailOrUsername: 'founder@strangetheory.test',
        password: 'Velvet-Synapse-2026!',
      });
      assert.equal(adminLogin.status, 200);
      assert.equal(adminLogin.data.user.role, 'admin');

      const modUserId = (await modCandidate.request('GET', '/api/auth/me')).data.user.id;
      const memberId = (await member.request('GET', '/api/auth/me')).data.user.id;

      // Visitor & member denied moderation & role promotion
      assert.equal((await visitor.request('GET', '/api/admin/moderation')).status, 403);
      assert.equal((await member.request('GET', '/api/admin/moderation')).status, 403);
      assert.equal((await member.request('POST', `/api/admin/users/${modUserId}/role`, { role: 'moderator' })).status, 403);
      assert.equal((await member.request('POST', '/api/auth/demo-switch', { userId: 'user-editorial' })).status, 403);

      // Admin promotes modCandidate to moderator
      const prom = await admin.request('POST', `/api/admin/users/${modUserId}/role`, { role: 'moderator' });
      assert.equal(prom.status, 200);
      assert.equal(prom.data.user.role, 'moderator');

      // Moderator can view moderation queue, cannot promote roles or ban admin
      assert.equal((await modCandidate.request('GET', '/api/admin/moderation')).status, 200);
      assert.equal((await modCandidate.request('POST', `/api/admin/users/${memberId}/role`, { role: 'admin' })).status, 403);
      const adminId = adminLogin.data.user.id;
      assert.equal(
        (await modCandidate.request('POST', '/api/admin/moderation/action', { target_type: 'user', target_id: adminId, action: 'ban' })).status,
        403
      );

      // CSRF mismatch rejected
      const badCsrf = await member.request(
        'PUT',
        '/api/reactions',
        { target_type: 'post', target_id: 'post-exp-1', kind: 'mind_blown' },
        { 'x-csrf-token': 'invalid-csrf-token' }
      );
      assert.equal(badCsrf.status, 403);
      assert.equal(badCsrf.data.code, 'CSRF_MISMATCH');

      // Member publishes a post, cannot react to own post, moderator hides it, author cannot unhide
      const d = await member.request('POST', '/api/posts', {
        type: 'experiment',
        title: 'Self Reaction and Moderation Test',
        intro: 'Verifying self reaction block and moderation hide.',
        category_ids: ['cat-physics'],
        ai_assisted: false,
        body_json: { premise: '<p>Initial.</p>', ripples: '', breaks_down: '' },
      });
      const postId = d.data.post.id;
      assert.equal((await member.request('POST', `/api/posts/${postId}/publish`, {})).status, 200);

      const selfReact = await member.request('PUT', '/api/reactions', {
        target_type: 'post',
        target_id: postId,
        kind: 'mind_blown',
      });
      assert.equal(selfReact.status, 403);
      assert.equal(selfReact.data.code, 'SELF_REACTION');

      assert.equal((await modCandidate.request('PATCH', `/api/posts/${postId}`, { title: 'Hijack' })).status, 403);

      const hideRes = await modCandidate.request('POST', '/api/admin/moderation/action', {
        target_type: 'post',
        target_id: postId,
        action: 'hide',
        note: 'Policy review',
      });
      assert.equal(hideRes.status, 200);

      const unhideRes = await member.request('POST', `/api/posts/${postId}/publish`, {});
      assert.equal(unhideRes.status, 403);
      assert.equal(unhideRes.data.code, 'POST_HIDDEN_BY_MODERATION');
    },
    {
      ADMIN_EMAIL: 'founder@strangetheory.test',
      ADMIN_PASSWORD: 'Velvet-Synapse-2026!',
    }
  );
});

test('End-to-end flow: Mind-Change votes, insight reaction (+2), leaderboard, export, account deletion, upload fallback, and SEO routes', async () => {
  await withServer(async (baseUrl) => {
    const userA = await signupAndVerify(baseUrl, {
      email: 'alice@example.com',
      username: 'alice_newton',
      display_name: 'Alice Newton',
      ageHours: 48,
    });
    const userB = await signupAndVerify(baseUrl, {
      email: 'bob@example.com',
      username: 'bob_kepler',
      display_name: 'Bob Kepler',
      ageHours: 48,
    });

    // Valid 1x1 PNG upload served cleanly via /api/assets/:id
    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const uploadRes = await userA.request('POST', '/api/uploads', {
      dataUrl: `data:image/png;base64,${pngBase64}`,
    });
    assert.equal(uploadRes.status, 201);
    assert.ok(String(uploadRes.data.url).startsWith('/api/assets/'));
    const assetFetch = await fetch(`${baseUrl}${uploadRes.data.url}`);
    assert.equal(assetFetch.status, 200);
    assert.equal(assetFetch.headers.get('content-type'), 'image/png');

    // Invalid SVG upload rejected
    const badUpload = await userA.request('POST', '/api/uploads', {
      dataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    });
    assert.equal(badUpload.status, 400);

    // Draft -> update -> publish (+5)
    const draft = await userA.request('POST', '/api/posts', {
      type: 'experiment',
      title: 'What if sleep memories were tradeable?',
      intro: 'A market in consolidated REM insights reshapes education and inequality.',
      cover_url: uploadRes.data.url,
      category_ids: ['cat-consciousness', 'cat-systems'],
      perspective: 'Future',
      thinking_style: 'Speculative',
      ai_assisted: true,
      ai_disclosure: 'Checked citations on memory consolidation.',
      body_json: {
        premise: '<p>Suppose neural replay patterns can be encoded and replayed across sleepers.</p>',
        ripples: '<p>1st: Exam prep disappears. 2nd: Cognitive copyright emerges.</p>',
        breaks_down: '<p>Episodic memories depend on personal emotional context.</p>',
        free_content: '<p>See related work on cortical plasticity.</p>',
        tags: ['memory', 'economics'],
      },
    });
    assert.equal(draft.status, 201);
    const postId = draft.data.post.id;

    assert.equal((await userA.request('POST', `/api/posts/${postId}/publish`, {})).status, 200);
    assert.equal((await userA.request('GET', '/api/auth/me')).data.user.synapse_total, 5);

    // Bob records Mind-Change before/after and insight reaction (+2 to Alice)
    const mcBefore = await userB.request('PUT', `/api/posts/${postId}/mind-change`, { phase: 'before', score: 25 });
    assert.equal(mcBefore.status, 200);
    const mcAfter = await userB.request('PUT', `/api/posts/${postId}/mind-change`, { phase: 'after', score: 75 });
    assert.equal(mcAfter.data.mind_change.delta_avg, 50);

    const react = await userB.request('PUT', '/api/reactions', { target_type: 'post', target_id: postId, kind: 'changed_mind' });
    assert.equal(react.status, 200);
    assert.equal((await userA.request('GET', '/api/auth/me')).data.user.synapse_total, 7);

    // Leaderboard includes Alice with 7 points
    const lb = await userA.request('GET', '/api/leaderboard?window=week');
    const aliceEntry = lb.data.leaders.find((l: any) => l.username === 'alice_newton');
    assert.equal(aliceEntry.synapse_total, 7);

    // Health, robots, sitemap, and unique covers on feed
    const health = await userA.request('GET', '/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.data.ok, true);
    assert.equal((await userA.request('GET', '/robots.txt')).status, 200);
    const sitemap = await userA.request('GET', '/sitemap.xml');
    assert.equal(sitemap.status, 200);
    assert.ok(sitemap.text.includes('/post/what-if-sleep-memories-were-tradeable'));

    // Data export and account deletion
    const expRes = await userA.request('GET', '/api/users/me/export');
    assert.equal(expRes.status, 200);
    assert.equal(expRes.data.profile.username, 'alice_newton');

    const del = await userA.request('DELETE', '/api/users/me');
    assert.equal(del.status, 200);
    assert.equal((await userA.request('GET', '/api/auth/me')).data.user, null);
    const remaining = await queryOne<{ c: number }>("SELECT COUNT(*) as c FROM users WHERE username = 'alice_newton'");
    assert.equal(Number(remaining?.c || 0), 0);
  });
});

test('Security audit: draft isolation, CSRF missing-cookie bypass, cross-origin check, and cron maintenance auth', async () => {
  await withServer(
    async (baseUrl) => {
      const author = await signupAndVerify(baseUrl, {
        email: 'draft_author@example.com',
        username: 'draft_author',
        display_name: 'Draft Author',
      });
      const attacker = await signupAndVerify(baseUrl, {
        email: 'attacker@example.com',
        username: 'draft_attacker',
        display_name: 'Draft Attacker',
      });

      const draftRes = await author.request('POST', '/api/posts', {
        type: 'riddle',
        title: 'Private Draft Vault',
        intro: 'Unpublished draft riddle that must remain sealed.',
        category_ids: ['cat-language'],
        ai_assisted: false,
        riddle: {
          difficulty: 'Hard',
          riddle_type: 'Logic',
          hints: ['Secret Draft Hint'],
          answer_text: 'DRAFT_ANSWER',
          answer_keywords: ['draft'],
          explanation: 'Secret draft explanation.',
          reveal_mode: 'author',
          reveal_days: 7,
        },
      });
      assert.equal(draftRes.status, 201);
      const draftId = draftRes.data.post.id;
      const draftSlug = draftRes.data.post.slug;

      assert.equal((await attacker.request('GET', `/api/posts/${draftId}`)).status, 403);
      assert.equal((await attacker.request('GET', `/api/posts/by-slug/${draftSlug}`)).status, 403);
      assert.equal((await attacker.request('GET', `/api/posts/${draftId}/comments`)).status, 403);
      assert.equal((await attacker.request('PATCH', `/api/posts/${draftId}`, { title: 'Steal' })).status, 403);
      assert.equal((await attacker.request('DELETE', `/api/posts/${draftId}`)).status, 403);

      const sessionOnly = attacker.cookies.get('st_session')!;
      const rawResp = await fetch(`${baseUrl}/api/bookmarks/post-exp-1`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `st_session=${sessionOnly}`,
        },
        body: '{}',
      });
      assert.equal(rawResp.status, 403);

      const crossOriginResp = await attacker.request('POST', '/api/bookmarks/post-exp-1', {}, {
        origin: 'https://evil-attacker.example',
      });
      assert.equal(crossOriginResp.status, 403);
      assert.equal(crossOriginResp.data.code, 'ORIGIN_MISMATCH');

      // Cron authentication & maintenance
      assert.equal((await attacker.request('GET', '/api/cron/daily')).status, 401);
      const cronOk = await attacker.request('GET', '/api/cron/daily', undefined, {
        authorization: 'Bearer unit-cron-secret-123',
      });
      assert.equal(cronOk.status, 200);
      assert.equal(cronOk.data.ok, true);
      assert.ok(cronOk.data.experimentId);
    },
    { CRON_SECRET: 'unit-cron-secret-123' }
  );
});

test('Launch features E2E: Onboarding + For You, My Brain + Progress, OG zero-leak, Weekly Digest + Unsubscribe, Collections, Dashboard, Weekly Challenge', async () => {
  await withServer(
    async (baseUrl) => {
      const visitor = createSession(baseUrl);
      const alice = await signupAndVerify(baseUrl, {
        email: 'launch_alice@example.com',
        username: 'launch_alice',
        display_name: 'Launch Alice',
        ageHours: 48,
      });
      const bob = await signupAndVerify(baseUrl, {
        email: 'launch_bob@example.com',
        username: 'launch_bob',
        display_name: 'Launch Bob',
        ageHours: 48,
      });

      // 1. Onboarding & For You (<= 6)
      const onboardingRes = await alice.request('POST', '/api/onboarding', {
        favorite_category_ids: ['cat-physics', 'cat-consciousness'],
        reading_goal_per_week: 5,
        weekly_digest_enabled: true,
      });
      assert.equal(onboardingRes.status, 200);
      assert.equal(onboardingRes.data.user.onboarding_completed, true);
      assert.equal(onboardingRes.data.user.weekly_digest_enabled, true);
      assert.equal(onboardingRes.data.user.reading_goal_per_week, 5);

      const forYouRes = await alice.request('GET', '/api/posts/for-you');
      assert.equal(forYouRes.status, 200);
      assert.equal(forYouRes.data.personalized, true);
      assert.ok(forYouRes.data.items.length >= 1 && forYouRes.data.items.length <= 6);

      // 2. Reading progress & My Brain stats
      const expSlug = forYouRes.data.items[0].slug;
      const expGet = await alice.request('GET', `/api/posts/by-slug/${expSlug}`);
      assert.equal(expGet.status, 200);
      const expId = expGet.data.post.id;

      const progRes = await alice.request('POST', `/api/posts/${expId}/progress`, {
        progress_pct: 68,
        last_section: 'ripples',
      });
      assert.equal(progRes.status, 200);
      assert.equal(progRes.data.reading_progress.progress_pct, 68);
      assert.equal(progRes.data.reading_progress.last_section, 'ripples');

      const myBrainRes = await alice.request('GET', '/api/my-brain');
      assert.equal(myBrainRes.status, 200);
      assert.equal(myBrainRes.data.signed_in, true);
      assert.ok(myBrainRes.data.stats.entries_read >= 1);
      assert.ok(myBrainRes.data.stats.current_streak >= 1);
      assert.equal(myBrainRes.data.badges.length, 12);

      // 3. OG Share SVG zero-leak test on unpublished/unrevealed riddle
      const riddleDraft = await alice.request('POST', '/api/posts', {
        type: 'riddle',
        title: 'Quantum Mirror Lock',
        intro: 'Why does the mirror show yesterday?',
        category_ids: ['cat-physics'],
        ai_assisted: false,
        riddle: {
          difficulty: 'Medium',
          riddle_type: 'Logic',
          hints: ['Think of light delay'],
          answer_text: 'ULTRA_SECRET_MIRROR_ANSWER',
          answer_keywords: ['light delay', 'distance'],
          explanation: 'SECRET_MIRROR_EXPLANATION',
          reveal_mode: 'author',
          reveal_days: 7,
        },
      });
      assert.equal(riddleDraft.status, 201);
      const riddleId = riddleDraft.data.post.id;
      const riddleSlug = riddleDraft.data.post.slug;
      assert.equal((await alice.request('POST', `/api/posts/${riddleId}/publish`, {})).status, 200);

      const ogSvg = await visitor.request('GET', `/api/og/${riddleSlug}.svg`);
      assert.equal(ogSvg.status, 200);
      assert.equal(ogSvg.text.includes('ULTRA_SECRET_MIRROR_ANSWER'), false);
      assert.equal(ogSvg.text.includes('SECRET_MIRROR_EXPLANATION'), false);

      // Bob solves Alice's riddle -> author gets authored_riddle_solved notification, solver gets riddle_revealed on reveal
      const bobAnswer = await bob.request('POST', `/api/posts/${riddleId}/comments`, {
        lens: 'answer',
        body: 'Because of light delay over distance.',
      });
      assert.equal(bobAnswer.status, 201);
      assert.equal((await alice.request('POST', `/api/riddles/${riddleId}/accept/${bobAnswer.data.comment.id}`, {})).status, 200);
      assert.equal((await alice.request('POST', `/api/riddles/${riddleId}/reveal`, {})).status, 200);

      const aliceNotifs = await alice.request('GET', '/api/notifications');
      assert.ok(aliceNotifs.data.items.some((n: any) => n.kind === 'authored_riddle_solved'));
      const bobNotifs = await bob.request('GET', '/api/notifications');
      assert.ok(bobNotifs.data.items.some((n: any) => n.kind === 'riddle_revealed'));

      // 4. Author Dashboard reflects authored post metrics
      const dashRes = await alice.request('GET', '/api/dashboard');
      assert.equal(dashRes.status, 200);
      const authoredEntry = dashRes.data.entries.find((e: any) => e.id === riddleId);
      assert.ok(authoredEntry);
      assert.equal(authoredEntry.solve_rate, 100);

      // 5. Collections CRUD, private boundary (403), and 10-collection focus limit
      const privCol = await alice.request('POST', '/api/collections', {
        title: 'Private Paradox Shelf',
        note: 'Hidden notes',
        is_public: false,
      });
      assert.equal(privCol.status, 201);
      const privSlug = privCol.data.collection.slug;
      assert.equal((await bob.request('GET', `/api/collections/${privSlug}`)).status, 403);
      assert.equal((await alice.request('POST', `/api/collections/${privCol.data.collection.id}/items`, { post_id: expId })).status, 201);

      const pubCol = await alice.request('POST', '/api/collections', {
        title: 'Public Mind Shifters',
        note: 'Shared list',
        is_public: true,
      });
      assert.equal(pubCol.status, 201);
      const alicePublicCols = await visitor.request('GET', '/api/collections?username=launch_alice');
      assert.equal(alicePublicCols.data.collections.length, 1);
      assert.equal(alicePublicCols.data.collections[0].title, 'Public Mind Shifters');

      // 8 more to hit 10 max, 11th rejected
      for (let i = 3; i <= 10; i++) {
        assert.equal((await alice.request('POST', '/api/collections', { title: `Shelf ${i}`, is_public: false })).status, 201);
      }
      const eleventh = await alice.request('POST', '/api/collections', { title: 'Shelf 11', is_public: false });
      assert.equal(eleventh.status, 400);
      assert.equal(eleventh.data.code, 'COLLECTION_LIMIT');

      // 6. Weekly Riddle Challenge + Weekly Digest cron (1 email/week cap + HMAC unsubscribe)
      const weeklyRes = await alice.request('GET', '/api/weekly-riddle');
      assert.equal(weeklyRes.status, 200);
      assert.ok(weeklyRes.data.week_key);
      assert.ok(weeklyRes.data.riddle);

      const weeklyCron1 = await visitor.request('POST', '/api/cron/weekly', {}, {
        authorization: 'Bearer launch-cron-secret',
      });
      assert.equal(weeklyCron1.status, 200);
      assert.equal(weeklyCron1.data.weeklyEmailsSent, 1);

      // Re-running in the same week respects max 1 email per week cap
      const weeklyCron2 = await visitor.request('POST', '/api/cron/weekly', {}, {
        authorization: 'Bearer launch-cron-secret',
      });
      assert.equal(weeklyCron2.status, 200);
      assert.equal(weeklyCron2.data.weeklyEmailsSent, 0);

      // Verify signed one-click unsubscribe from email outbox link
      const outboxRow = await queryOne<{ text: string; action_url: string }>(
        "SELECT text, action_url FROM email_outbox WHERE to_email = 'launch_alice@example.com' ORDER BY created_at DESC LIMIT 1"
      );
      assert.ok(outboxRow?.text);
      const match = outboxRow!.text.match(/\/api\/digest\/unsubscribe\?token=([^\s]+)/);
      assert.ok(match, 'Weekly digest email must include signed unsubscribe link');
      const unsubRes = await visitor.request('GET', `/api/digest/unsubscribe?token=${match![1]}&format=json`);
      assert.equal(unsubRes.status, 200);
      assert.equal(unsubRes.data.unsubscribed, true);
      assert.equal((await alice.request('GET', '/api/auth/me')).data.user.weekly_digest_enabled, false);
    },
    { CRON_SECRET: 'launch-cron-secret' }
  );
});

