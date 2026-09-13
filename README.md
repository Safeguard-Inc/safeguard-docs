# Safeguard Docs

[![CI](https://github.com/Safeguard-Inc/safeguard-docs/actions/workflows/ci.yml/badge.svg)](https://github.com/Safeguard-Inc/safeguard-docs/actions/workflows/ci.yml)
[![Deployment](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fsafeguard-docs.vercel.app%2Fdata%2Fdeployment.json&query=%24.status&label=Vercel&color=4ade9b)](https://safeguard-docs.vercel.app)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

**DOCUMENTATION HUB for the Safeguard compliance stack on Stellar Confidential Tokens.**

This is the fourth repository in the stack. It is not a library and not a
contract: it is the place a reader, an integrator or a reviewer lands first,
and the place where the project's behaviour is demonstrated rather than only
described.

```
             SAFEGUARD
                 │
       ┌─────────┼─────────┐
       ▼         ▼         ▼
    POLICY      HOOKS     AUDIT
    DEFINE     ENFORCE    VERIFY
       │           │         │
       └───────────┴─────────┘
                   │
                   ▼
                 DOCS
          explain · demonstrate · verify
```

| Repository | Role | Question it answers |
| ---------- | ---- | ------------------- |
| [`safeguard-policy`](https://github.com/Safeguard-Inc/safeguard-policy) | **Define** | What are the rules? |
| [`safeguard-hooks`](https://github.com/Safeguard-Inc/safeguard-hooks) | **Enforce** | Make it happen on-chain. |
| [`safeguard-audit`](https://github.com/Safeguard-Inc/safeguard-audit) | **Verify** | What actually happened? |
| **`safeguard-docs`** | **Explain** | **How does it fit together, and does it work?** |

---

## What is in here

| Path | What it is |
| ---- | ---------- |
| `index.html` | Landing page: the problem, the three-layer solution, the live deployment and a quickstart. |
| `demo.html` | An interactive evaluation of the policy decision engine, running entirely in the browser. |
| `docs/architecture.html` | The two versioned seams, the decision precedence table, the fail-closed posture and the error-code scheme. |
| `docs/contracts.html` | The live Testnet deployment record: contract ids, admin key, policy state, enforcement state and what was verified. |
| `docs/error-codes.md` | The consolidated error-code registry across all three layers. |
| `assets/engine.js` | A reference implementation of the decision engine, mirroring the documented precedence. |
| `tests/engine.test.mjs` | Holds that reference implementation to the upstream project's own golden decisions. |
| `data/` | Verbatim copies of upstream policy fixtures, with provenance recorded. |

---

## The demo is verifiable, not decorative

A reference implementation on a documentation site is a liability if it
quietly disagrees with the real engine — it teaches readers the wrong
behaviour with confidence.

So the demo is held to the project's own decisions. `data/golden-decisions.json`
is a verbatim copy of
[`safeguard-policy/crates/safeguard-sdk/tests/fixtures/decisions.json`](https://github.com/Safeguard-Inc/safeguard-policy/blob/main/crates/safeguard-sdk/tests/fixtures/decisions.json).
For every recorded outcome the test suite constructs an input and asserts that
the demo's `(decision, reason code, rule id)` triple matches **exactly**. Every
cell of the documented account-status and jurisdiction tables is asserted too,
so the prose on the site cannot drift from the code either.

```bash
npm test
```

```
✔ golden parity #1: a compliant subject
✔ golden parity #2: a non-member under an allowlist rule
✔ golden parity #3: a sanctions match under a flagging sanctions rule
✔ golden parity #4: a frozen account
✔ golden parity #5: a prohibited jurisdiction
✔ golden parity #6: an unknown jurisdiction
✔ an unrecognized account status fails closed to unknown, never active
✔ precedence: account status outranks every policy rule
✔ the engine is a pure function of its request
...
ℹ pass 24
ℹ fail 0
```

The authoritative implementations remain the Rust engine in
`safeguard-policy/crates/safeguard-core` and the Soroban contract in
`safeguard-policy/crates/safeguard-contract`.

---

## Running it locally

There is no build step. The site is static HTML, CSS and ES modules, so it
renders identically everywhere — including offline.

```bash
git clone https://github.com/Safeguard-Inc/safeguard-docs
cd safeguard-docs

npm test          # the engine/fixture parity suite
npm run serve     # http://localhost:4173
```

`npm run serve` uses Python's built-in server; any static file server works.
Opening `index.html` directly from the filesystem will not load the demo,
because ES modules and `fetch` require an HTTP origin.

---

## Deployment

The site is deployed on Vercel from `main` through the Git integration, so a
merge to `main` is a deployment. `vercel.json` carries the static-site
configuration and the security headers.

| | |
| --- | --- |
| Production | <https://safeguard-docs.vercel.app> |
| Framework | none — static (`cleanUrls` enabled) |
| Build command | none |
| Output directory | repository root |

`data/deployment.json` is fetched by the README badge, so the badge reports the
deployment's own recorded status rather than a hard-coded value.

---

## Live deployment

The stack is deployed to Stellar Testnet and the addresses are recorded on
[`docs/contracts.html`](docs/contracts.html) and in each repository's own
deployment file:

| Layer | Contract |
| ----- | -------- |
| Policy (DEFINE) | `CDVME6OPYZO6RAIWRFKLI3ACZHPNZK7GDBIX7YSIER3QLA2SO47QX5IB` |
| Hooks (ENFORCE) | `CC7UKMCY3J7LB2WGU6D3MPRSSK3RKEC6MEXJJKOXRPTZAPRNXKPVPKPN` |

Confidential Tokens on Stellar are a developer preview. Treat these
deployments as a rehearsal, not production. No admin secret key is stored in
any repository.

---

## Contributing

Contributions to the documentation are as welcome as contributions to the
code, and are held to the same standard:

- **Claims must be checkable.** If a page states a contract behaves a certain
  way, link the file, the test or the transaction that shows it.
- **Do not hand-write what can be generated.** The error-code registry and the
  golden parity suite exist so that documentation cannot drift from source.
- **Fixtures are copies, not edits.** If an upstream fixture changes, copy it
  again and update `data/PROVENANCE.json`; do not edit the copy.

See [`CONTRIBUTING.md`](CONTRIBUTING.md), the
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) and [`SECURITY.md`](SECURITY.md).

---

## License

Apache-2.0 — see [`LICENSE`](LICENSE).
