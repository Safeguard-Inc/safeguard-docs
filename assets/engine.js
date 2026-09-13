/**
 * Safeguard policy decision engine — browser-side reference implementation.
 *
 * This is a faithful mirror of the precedence and reason codes documented in
 * safeguard-policy's `docs/rule-engine.md`, which is itself pinned by the
 * property tests in `crates/safeguard-core`. It exists so the documentation
 * site can demonstrate a decision without a server, a wallet or a network
 * call.
 *
 * ## What is authoritative
 *
 * The authoritative implementations are:
 *   - the Rust engine in `safeguard-policy/crates/safeguard-core` (off-chain), and
 *   - the Soroban contract in `safeguard-policy/crates/safeguard-contract` (on-chain).
 *
 * This file is a *demonstration*, not a second source of truth. It is held to
 * the project's own golden decision fixture by `tests/engine.test.mjs`, which
 * asserts that the (decision, reason code, rule id) triples produced here are
 * exactly the ones recorded in
 * `safeguard-policy/crates/safeguard-sdk/tests/fixtures/decisions.json`.
 * If this file and that fixture ever disagree, the test fails.
 *
 * ## Determinism
 *
 * The engine is a pure function of its request: no randomness, no wall-clock
 * time, no hidden state, no network calls. Identical input always produces an
 * identical decision.
 *
 * @module engine
 */

/** The three outcomes an evaluation can resolve to. */
export const Decision = Object.freeze({
  APPROVE: 'APPROVE',
  BLOCK: 'BLOCK',
  FLAG: 'FLAG',
});

/** Rule actions, as they appear in a policy document. */
export const Action = Object.freeze({
  BLOCK: 'block',
  FLAG: 'flag',
});

/**
 * Stable reason codes. These are public API: they are serialized into policy
 * decisions and audit records, so they are never renamed or renumbered.
 */
export const ReasonCode = Object.freeze({
  NO_REASON: 'no_reason',
  ACCOUNT_FROZEN: 'account_frozen',
  ACCOUNT_SUSPENDED: 'account_suspended',
  ACCOUNT_RESTRICTED: 'account_restricted',
  ACCOUNT_STATUS_UNKNOWN: 'account_status_unknown',
  ALLOWLIST_REQUIRED: 'allowlist_required',
  DENYLIST_MATCH: 'denylist_match',
  SANCTIONS_MATCH: 'sanctions_match',
  JURISDICTION_RESTRICTED: 'jurisdiction_restricted',
  JURISDICTION_PROHIBITED: 'jurisdiction_prohibited',
  JURISDICTION_UNKNOWN: 'jurisdiction_unknown',
});

/**
 * Account status is structural: the meaning of a status is uniform and is
 * never configurable by policy wording. A frozen account is blocked whatever
 * the policy says.
 */
const ACCOUNT_STATUS_OUTCOMES = Object.freeze({
  active: null,
  restricted: { decision: Decision.FLAG, reason: ReasonCode.ACCOUNT_RESTRICTED },
  frozen: { decision: Decision.BLOCK, reason: ReasonCode.ACCOUNT_FROZEN },
  suspended: { decision: Decision.BLOCK, reason: ReasonCode.ACCOUNT_SUSPENDED },
  unknown: { decision: Decision.FLAG, reason: ReasonCode.ACCOUNT_STATUS_UNKNOWN },
});

/** The canonical evaluation order. The first decisive outcome wins. */
export const PRECEDENCE = Object.freeze([
  'account_status',
  'allowlist',
  'denylist',
  'sanctions',
  'jurisdiction',
]);

function actionToDecision(action) {
  return action === Action.BLOCK ? Decision.BLOCK : Decision.FLAG;
}

/**
 * Normalize an account status. Anything unrecognized maps to `unknown`, which
 * flags rather than widening the outcome — junk input must never approve.
 */
function normalizeStatus(status) {
  const key = typeof status === 'string' ? status.trim().toLowerCase() : '';
  return Object.hasOwn(ACCOUNT_STATUS_OUTCOMES, key) ? key : 'unknown';
}

/**
 * Classify a region against a jurisdiction rule.
 * @returns {'permitted'|'restricted'|'prohibited'|'unknown'}
 */
function classifyRegion(region, rule) {
  const code = typeof region === 'string' ? region.trim().toUpperCase() : '';
  const regions = rule.regions ?? {};
  const inList = (list) => Array.isArray(list) && list.map((r) => String(r).toUpperCase()).includes(code);
  if (code && inList(regions.permitted)) return 'permitted';
  if (code && inList(regions.prohibited)) return 'prohibited';
  if (code && inList(regions.restricted)) return 'restricted';
  return 'unknown';
}

const REGION_REASON = Object.freeze({
  restricted: ReasonCode.JURISDICTION_RESTRICTED,
  prohibited: ReasonCode.JURISDICTION_PROHIBITED,
  unknown: ReasonCode.JURISDICTION_UNKNOWN,
});

/**
 * Evaluate a policy against a fully materialized request.
 *
 * The request is a snapshot: the caller resolves every piece of external
 * state (identity registry, sanctions screening, jurisdiction attestation)
 * and hands it over. A category absent from the request is skipped. The
 * request alone determines the decision.
 *
 * @param {object} policy   A policy document: `{ policy_id, version, rules[] }`.
 * @param {object} request  The evaluation snapshot (see `docs/architecture.md`).
 * @returns {{decision: string, policy_id: string, policy_version: number,
 *            rule_id?: string, reason_code: string, trace: Array}}
 *          A decision document. `trace` is a demonstration-only addition that
 *          records every gate considered, in order; it is not part of the
 *          on-chain decision document.
 */
export function evaluate(policy, request) {
  const context = request ?? {};
  const trace = [];

  const base = {
    policy_id: policy.policy_id,
    policy_version: policy.version,
  };

  const decide = (decision, reasonCode, ruleId) => {
    const doc = { decision, ...base, reason_code: reasonCode };
    if (ruleId !== undefined) doc.rule_id = ruleId;
    doc.trace = trace;
    return doc;
  };

  const ruleOfType = (type) => (policy.rules ?? []).find((rule) => rule.type === type);

  // 1. Account status (structural, never configurable).
  const status = normalizeStatus(context.account_status);
  const statusOutcome = ACCOUNT_STATUS_OUTCOMES[status];
  if (statusOutcome) {
    trace.push({ gate: 'account_status', status, outcome: statusOutcome.decision });
    return decide(statusOutcome.decision, statusOutcome.reason);
  }
  trace.push({ gate: 'account_status', status, outcome: 'pass' });

  // 2. Allowlist — satisfied only by membership.
  const allowlistRule = ruleOfType('allowlist');
  if (allowlistRule) {
    const member = context.allowlist?.member === true;
    if (!member) {
      trace.push({ gate: 'allowlist', member, outcome: actionToDecision(allowlistRule.action) });
      return decide(actionToDecision(allowlistRule.action), ReasonCode.ALLOWLIST_REQUIRED, allowlistRule.id);
    }
    trace.push({ gate: 'allowlist', member, outcome: 'pass' });
  }

  // 3. Denylist — a listed subject triggers the rule action.
  const denylistRule = ruleOfType('denylist');
  if (denylistRule) {
    const matched = context.denylist?.matched === true;
    if (matched) {
      trace.push({ gate: 'denylist', matched, outcome: actionToDecision(denylistRule.action) });
      return decide(actionToDecision(denylistRule.action), ReasonCode.DENYLIST_MATCH, denylistRule.id);
    }
    trace.push({ gate: 'denylist', matched, outcome: 'pass' });
  }

  // 4. Sanctions — a screening match triggers the rule action. Under a
  //    blocking policy a match can never evaluate as APPROVE.
  const sanctionsRule = ruleOfType('sanctions');
  if (sanctionsRule) {
    const matched = context.sanctions?.matched === true;
    if (matched) {
      trace.push({ gate: 'sanctions', matched, outcome: actionToDecision(sanctionsRule.action) });
      return decide(actionToDecision(sanctionsRule.action), ReasonCode.SANCTIONS_MATCH, sanctionsRule.id);
    }
    trace.push({ gate: 'sanctions', matched, outcome: 'pass' });
  }

  // 5. Jurisdiction — the action applies to restricted, prohibited and
  //    unknown regions. Unknown regions fail closed.
  const jurisdictionRule = ruleOfType('jurisdiction');
  if (jurisdictionRule) {
    const classification = classifyRegion(context.jurisdiction?.region, jurisdictionRule);
    if (classification !== 'permitted') {
      trace.push({ gate: 'jurisdiction', region: classification, outcome: actionToDecision(jurisdictionRule.action) });
      return decide(actionToDecision(jurisdictionRule.action), REGION_REASON[classification], jurisdictionRule.id);
    }
    trace.push({ gate: 'jurisdiction', region: classification, outcome: 'pass' });
  }

  // 6. Otherwise, approve.
  trace.push({ gate: 'default', outcome: Decision.APPROVE });
  return decide(Decision.APPROVE, ReasonCode.NO_REASON);
}
