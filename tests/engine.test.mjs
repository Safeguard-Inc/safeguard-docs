/**
 * Holds the browser-side demo engine to the upstream project's own decisions.
 *
 * The risk with a reference implementation on a documentation site is that it
 * quietly disagrees with the real engine and teaches readers the wrong
 * behaviour. This suite closes that gap in two ways:
 *
 *  1. Golden parity. `data/golden-decisions.json` is a verbatim copy of
 *     `safeguard-policy/crates/safeguard-sdk/tests/fixtures/decisions.json`.
 *     For each recorded decision an input is constructed, and the
 *     (decision, reason code, rule id) triple the demo produces must equal the
 *     recorded one exactly. A silent divergence fails here.
 *
 *  2. Documented table coverage. `docs/rule-engine.md` publishes an account
 *     status table and a region/action table. Every cell is asserted, so the
 *     prose on the site cannot drift from the code either.
 *
 * Run: node --test tests/
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { evaluate, Decision, ReasonCode, PRECEDENCE } from '../assets/engine.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

const combined = load('data/combined-policy.json');
const golden = load('data/golden-decisions.json');

/** A request that would approve under the combined policy. */
const CLEAN = Object.freeze({
  account_status: 'active',
  allowlist: { member: true },
  denylist: { matched: false },
  sanctions: { matched: false },
  jurisdiction: { region: 'US' },
});

const withOverrides = (overrides) => ({ ...CLEAN, ...overrides });

// ---------------------------------------------------------------------------
// 1. Golden parity with the upstream fixture
// ---------------------------------------------------------------------------

/**
 * The fixture records six outcomes. This maps each recorded outcome to an
 * input that must produce it, so the fixture becomes an executable contract
 * rather than a document.
 */
const GOLDEN_INPUTS = [
  {
    describe: 'a compliant subject',
    request: CLEAN,
    expect: { decision: 'APPROVE', reason_code: 'no_reason' },
  },
  {
    describe: 'a non-member under an allowlist rule',
    request: withOverrides({ allowlist: { member: false } }),
    expect: { decision: 'BLOCK', rule_id: 'ALLOWLIST-001', reason_code: 'allowlist_required' },
  },
  {
    describe: 'a sanctions match under a flagging sanctions rule',
    request: withOverrides({ sanctions: { matched: true } }),
    expect: { decision: 'FLAG', rule_id: 'SANCTIONS-001', reason_code: 'sanctions_match' },
  },
  {
    describe: 'a frozen account',
    request: withOverrides({ account_status: 'frozen' }),
    expect: { decision: 'BLOCK', reason_code: 'account_frozen' },
  },
  {
    describe: 'a prohibited jurisdiction',
    request: withOverrides({ jurisdiction: { region: 'IR' } }),
    expect: { decision: 'BLOCK', rule_id: 'JURISDICTION-001', reason_code: 'jurisdiction_prohibited' },
  },
  {
    describe: 'an unknown jurisdiction',
    request: withOverrides({ jurisdiction: { region: 'ZZ' } }),
    expect: { decision: 'BLOCK', rule_id: 'JURISDICTION-001', reason_code: 'jurisdiction_unknown' },
  },
];

test('the golden fixture and its executable inputs are the same length', () => {
  assert.equal(
    golden.length,
    GOLDEN_INPUTS.length,
    'the upstream fixture gained or lost an outcome; update GOLDEN_INPUTS so every recorded decision has a producer',
  );
});

for (const [index, recorded] of golden.entries()) {
  const { describe, request, expect } = GOLDEN_INPUTS[index];

  test(`golden parity #${index + 1}: ${describe}`, () => {
    // The fixture is the source of truth: assert the mapping itself is right
    // before asserting the engine agrees with it.
    assert.equal(recorded.decision, expect.decision);
    assert.equal(recorded.reason_code, expect.reason_code);
    assert.equal(recorded.rule_id, expect.rule_id);

    const actual = evaluate(combined, request);
    assert.equal(actual.decision, recorded.decision);
    assert.equal(actual.reason_code, recorded.reason_code);
    assert.equal(actual.rule_id ?? null, recorded.rule_id ?? null);
    assert.equal(actual.policy_id, recorded.policy_id);
    assert.equal(actual.policy_version, recorded.policy_version);
  });
}

// ---------------------------------------------------------------------------
// 2. The documented account-status table
// ---------------------------------------------------------------------------

const ACCOUNT_STATUS_TABLE = [
  { status: 'active', decision: 'APPROVE', reason: 'no_reason' },
  { status: 'restricted', decision: 'FLAG', reason: 'account_restricted' },
  { status: 'frozen', decision: 'BLOCK', reason: 'account_frozen' },
  { status: 'suspended', decision: 'BLOCK', reason: 'account_suspended' },
  { status: 'unknown', decision: 'FLAG', reason: 'account_status_unknown' },
];

for (const row of ACCOUNT_STATUS_TABLE) {
  test(`account status ${row.status} -> ${row.decision} (${row.reason})`, () => {
    const result = evaluate(combined, withOverrides({ account_status: row.status }));
    assert.equal(result.decision, row.decision);
    assert.equal(result.reason_code, row.reason);
    // Account status is structural: it never carries a rule id.
    assert.equal(result.rule_id, undefined);
  });
}

test('an unrecognized account status fails closed to unknown, never active', () => {
  const result = evaluate(combined, withOverrides({ account_status: 'ACTIVE' }));
  assert.equal(result.decision, Decision.APPROVE);
  for (const junk of ['', 'nonsense', null, undefined, 42, {}, 'froz en']) {
    const r = evaluate(combined, withOverrides({ account_status: junk }));
    assert.equal(r.decision, Decision.FLAG, `status ${JSON.stringify(junk)} must not approve`);
    assert.equal(r.reason_code, ReasonCode.ACCOUNT_STATUS_UNKNOWN);
  }
});

// ---------------------------------------------------------------------------
// 3. The documented region/action table
// ---------------------------------------------------------------------------

test('jurisdiction: permitted passes, restricted/prohibited/unknown take the rule action', () => {
  // The combined policy's jurisdiction rule blocks.
  const blocking = evaluate(combined, withOverrides({ jurisdiction: { region: 'US' } }));
  assert.equal(blocking.decision, Decision.APPROVE);

  const cases = [
    { region: 'RU', reason: 'jurisdiction_restricted' },
    { region: 'IR', reason: 'jurisdiction_prohibited' },
    { region: 'ZZ', reason: 'jurisdiction_unknown' },
    { region: '', reason: 'jurisdiction_unknown' },
    { region: null, reason: 'jurisdiction_unknown' },
  ];
  for (const { region, reason } of cases) {
    const r = evaluate(combined, withOverrides({ jurisdiction: { region } }));
    assert.equal(r.decision, Decision.BLOCK, `region ${JSON.stringify(region)} must block`);
    assert.equal(r.reason_code, reason);
  }
});

test('jurisdiction: a flagging rule flags where a blocking rule blocks', () => {
  const flagging = {
    ...combined,
    rules: combined.rules.map((rule) =>
      rule.type === 'jurisdiction' ? { ...rule, action: 'flag' } : rule,
    ),
  };
  for (const region of ['RU', 'IR', 'ZZ']) {
    const r = evaluate(flagging, withOverrides({ jurisdiction: { region } }));
    assert.equal(r.decision, Decision.FLAG, `region ${region} under a flagging rule`);
  }
});

// ---------------------------------------------------------------------------
// 4. Precedence
// ---------------------------------------------------------------------------

test('precedence: account status outranks every policy rule', () => {
  // A frozen account that is also a sanctions match must block for the
  // structural reason, not the policy one.
  const r = evaluate(
    combined,
    withOverrides({ account_status: 'frozen', sanctions: { matched: true }, allowlist: { member: false } }),
  );
  assert.equal(r.reason_code, ReasonCode.ACCOUNT_FROZEN);
  assert.equal(r.rule_id, undefined);
});

test('precedence: allowlist outranks denylist, sanctions and jurisdiction', () => {
  const r = evaluate(
    combined,
    withOverrides({
      allowlist: { member: false },
      denylist: { matched: true },
      sanctions: { matched: true },
      jurisdiction: { region: 'IR' },
    }),
  );
  assert.equal(r.reason_code, ReasonCode.ALLOWLIST_REQUIRED);
});

test('precedence: denylist outranks sanctions and jurisdiction', () => {
  const r = evaluate(
    combined,
    withOverrides({ denylist: { matched: true }, sanctions: { matched: true }, jurisdiction: { region: 'IR' } }),
  );
  assert.equal(r.reason_code, ReasonCode.DENYLIST_MATCH);
});

test('precedence: sanctions outranks jurisdiction', () => {
  const r = evaluate(combined, withOverrides({ sanctions: { matched: true }, jurisdiction: { region: 'IR' } }));
  assert.equal(r.reason_code, ReasonCode.SANCTIONS_MATCH);
});

test('the engine reports the documented precedence order', () => {
  assert.deepEqual([...PRECEDENCE], ['account_status', 'allowlist', 'denylist', 'sanctions', 'jurisdiction']);
});

// ---------------------------------------------------------------------------
// 5. Fail-closed posture and determinism
// ---------------------------------------------------------------------------

test('a sanctions match under a blocking sanctions rule can never approve', () => {
  const blocking = {
    ...combined,
    rules: combined.rules.map((rule) =>
      rule.type === 'sanctions' ? { ...rule, action: 'block' } : rule,
    ),
  };
  const r = evaluate(blocking, withOverrides({ sanctions: { matched: true } }));
  assert.equal(r.decision, Decision.BLOCK);
});

test('an absent category is skipped, not treated as a match', () => {
  const bare = { policy_id: 'bare', version: 1, rules: [{ id: 'X', type: 'denylist', action: 'block' }] };
  const r = evaluate(bare, { account_status: 'active' });
  assert.equal(r.decision, Decision.APPROVE);
});

test('the engine is a pure function of its request', () => {
  const request = withOverrides({ account_status: 'restricted', jurisdiction: { region: 'RU' } });
  const first = JSON.stringify({ ...evaluate(combined, request), trace: undefined });
  for (let i = 0; i < 200; i += 1) {
    const again = JSON.stringify({ ...evaluate(combined, structuredClone(request)), trace: undefined });
    assert.equal(again, first, `evaluation ${i} differed from the first`);
  }
});

test('the shipped institutional-default policy approves a clean subject', () => {
  const policy = load('data/institutional-default.json');
  const r = evaluate(policy, CLEAN);
  assert.equal(r.decision, Decision.APPROVE);
  assert.equal(r.policy_id, 'institutional-default');
});
