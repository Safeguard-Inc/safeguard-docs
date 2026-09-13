/**
 * Demo wiring: read the form, evaluate, render.
 *
 * All of the behaviour lives in `engine.js`; this file only moves values
 * between the DOM and the engine so the engine stays directly testable.
 */

import { evaluate } from './engine.js';

const POLICIES = {
  combined: './data/combined-policy.json',
  default: './data/institutional-default.json',
};

const $ = (id) => document.getElementById(id);

const elements = {
  policy: $('policy'),
  status: $('status'),
  allowMember: $('allow-member'),
  denyMatch: $('deny-match'),
  sanctionMatch: $('sanction-match'),
  region: $('region'),
  pill: $('decision-pill'),
  reasonCode: $('reason-code'),
  detail: $('decision-detail'),
  trace: $('trace'),
  json: $('json'),
};

const policyCache = new Map();

async function loadPolicy(key) {
  if (!policyCache.has(key)) {
    policyCache.set(key, fetch(POLICIES[key]).then((r) => {
      if (!r.ok) throw new Error(`could not load ${POLICIES[key]}: ${r.status}`);
      return r.json();
    }));
  }
  return policyCache.get(key);
}

/** Read the current form into an evaluation request. */
function readRequest() {
  return {
    account_status: elements.status.value,
    allowlist: { member: elements.allowMember.checked },
    denylist: { matched: elements.denyMatch.checked },
    sanctions: { matched: elements.sanctionMatch.checked },
    jurisdiction: { region: elements.region.value },
  };
}

function decisionRow(term, value) {
  const tr = document.createElement('tr');
  const th = document.createElement('td');
  th.innerHTML = `<strong>${term}</strong>`;
  const td = document.createElement('td');
  td.className = 'mono';
  td.textContent = value;
  tr.append(th, td);
  return tr;
}

function renderDecision(doc) {
  elements.pill.className = `pill ${doc.decision}`;
  elements.pill.textContent = doc.decision;
  elements.reasonCode.textContent = doc.reason_code;

  elements.detail.replaceChildren(
    decisionRow('policy_id', doc.policy_id),
    decisionRow('policy_version', String(doc.policy_version)),
    ...(doc.rule_id ? [decisionRow('rule_id', doc.rule_id)] : []),
    decisionRow('reason_code', doc.reason_code),
  );

  // The decision document as the SDK would serialize it: the demonstration
  // trace is not part of the published decision shape.
  const { trace, ...published } = doc;
  elements.json.textContent = JSON.stringify(published, null, 2);

  elements.trace.replaceChildren(
    ...trace.map((step) => {
      const row = document.createElement('div');
      row.className = 'trace-row';
      const gate = document.createElement('span');
      gate.className = 'gate';
      gate.textContent = step.gate;
      const outcome = document.createElement('span');
      const decisive = step.outcome !== 'pass';
      outcome.className = `outcome${decisive ? '' : ' pass'}`;
      outcome.textContent = decisive ? `→ ${step.outcome}` : 'pass';
      row.append(gate, outcome);
      return row;
    }),
  );
}

async function refresh() {
  try {
    const policy = await loadPolicy(elements.policy.value);
    renderDecision(evaluate(policy, readRequest()));
  } catch (error) {
    elements.pill.className = 'pill';
    elements.pill.textContent = 'ERROR';
    elements.reasonCode.textContent = String(error.message ?? error);
    elements.detail.replaceChildren();
    elements.trace.replaceChildren();
    elements.json.textContent = '';
  }
}

/** Preset buttons make the documented outcomes one click away. */
const PRESETS = {
  'preset-clean': { status: 'active', allow: true, deny: false, sanctions: false, region: 'US' },
  'preset-sanctions': { status: 'active', allow: true, deny: false, sanctions: true, region: 'US' },
  'preset-frozen': { status: 'frozen', allow: false, deny: false, sanctions: true, region: 'IR' },
};

function applyPreset(preset) {
  elements.status.value = preset.status;
  elements.allowMember.checked = preset.allow;
  elements.denyMatch.checked = preset.deny;
  elements.sanctionMatch.checked = preset.sanctions;
  elements.region.value = preset.region;
  refresh();
}

for (const [id, preset] of Object.entries(PRESETS)) {
  $(id).addEventListener('click', () => applyPreset(preset));
}

for (const el of [elements.policy, elements.status, elements.region]) {
  el.addEventListener('change', refresh);
}
for (const el of [elements.allowMember, elements.denyMatch, elements.sanctionMatch]) {
  el.addEventListener('change', refresh);
}

refresh();
