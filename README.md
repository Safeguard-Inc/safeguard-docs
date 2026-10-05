# Safeguard Docs

[![CI](https://github.com/Safeguard-Inc/safeguard-docs/actions/workflows/ci.yml/badge.svg)](https://github.com/Safeguard-Inc/safeguard-docs/actions/workflows/ci.yml)
[![Deployment](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fsafeguard-docs.vercel.app%2Fdata%2Fdeployment.json&query=%24.status&label=Vercel&color=4ade9b)](https://safeguard-docs.vercel.app)
[![Pitch video](https://img.shields.io/badge/pitch_video-5_minutes-4ade9b)](https://safeguard-docs.vercel.app/assets/video/safeguard-pitch.mp4)
[![Canonical Errors](https://img.shields.io/badge/Errors-270%20Cataloged-blue.svg)](docs/error-codes.md)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Live Console](https://img.shields.io/badge/Console-Live_Demo-brightgreen.svg)](https://safeguard-dashboard-mocha.vercel.app)

**DOCUMENTATION HUB & VERIFICATION SUITE for Safeguard on Stellar.**

## Pitch Video

[![Watch the five-minute pitch](assets/video/safeguard-pitch-poster.jpg)](https://safeguard-docs.vercel.app/assets/video/safeguard-pitch.mp4)

**Five minutes, end to end:** the problem, the 4-tier architecture, the live decision engine driven in a browser, and the contracts running on Testnet — with the real contract IDs, the read-only deployment verification, and the measured cost of an operation.

The video is *built from this repository* rather than edited by hand. The slides, the captures (photographed from this deployment as it runs), the voice-over, and the edit are all produced by [`video/`](video/), so the video cannot drift away from what the project does.

---

## Four-Tier Architecture

```text
                 SAFEGUARD ON STELLAR
                          │
       ┌──────────────────┼──────────────────┬──────────────────┐
       ▼                  ▼                  ▼                  ▼
   CONTRACTS           BACKEND           DASHBOARD             DOCS
DEFINE & ENFORCE      INTEGRATE           CONSOLE             VERIFY
```

| Repository | Role | Question it answers |
| :--- | :--- | :--- |
| [`safeguard-contracts`](https://github.com/Safeguard-Inc/safeguard-contracts) | **Define & Enforce** | What are the rules and how do tokens move on-chain? |
| [`safeguard-backend`](https://github.com/Safeguard-Inc/safeguard-backend) | **Integrate & Simulate** | How do client apps pre-flight payments and decode reverts? |
| [`safeguard-dashboard`](https://github.com/Safeguard-Inc/safeguard-dashboard) | **Operate & Disburse** | How do operators manage policies and submit transactions? |
| **`safeguard-docs`** | **Explain & Verify** | **How does it fit together, and does it work?** |

---

## What is in here

| Path | What it is |
| :--- | :--- |
| `index.html` | Landing page: the problem, four-tier architecture, live deployment table, and quickstart. |
| `demo.html` | An interactive evaluation of the policy decision engine, running entirely in the browser. |
| `docs/architecture.html` | The four-tier architecture, decision precedence, fail-closed posture, and 270 error codes taxonomy. |
| `docs/contracts.html` | The live Testnet deployment record: contract IDs, admin keys, parameters, and verification tests. |
| `docs/error-codes.md` | The canonical 270 error codes registry across all four tiers. |
| `assets/engine.js` | Reference JavaScript decision engine mirroring the Rust Soroban contract rules. |
| `tests/engine.test.mjs` | Automated parity test suite validating that the browser engine matches upstream golden fixtures. |
| `data/deployment.json` | Live deployment registry fetched dynamically by badges and clients. |

---

## The demo is verifiable, not decorative

A reference implementation on a documentation site is a liability if it quietly disagrees with the real engine — it teaches readers the wrong behaviour with confidence.

So the demo is held to the project's own decisions. For every recorded outcome the test suite constructs an input and asserts that the demo's `(decision, reason code, rule id)` triple matches **exactly**. Every cell of the documented account-status and jurisdiction tables is asserted too.

```bash
npm test
```

```text
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

The authoritative smart contract implementations remain the Rust engine in `safeguard-contracts/crates/safeguard-core` and the Soroban contracts in `safeguard-contracts/contracts/safeguard-payments` and `safeguard-contracts/contracts/safeguard-policy`.

---

## Running it locally

There is no build step. The site is static HTML, CSS, and ES modules, so it renders identically everywhere — including offline.

```bash
git clone https://github.com/Safeguard-Inc/safeguard-docs
cd safeguard-docs

npm test          # the engine/fixture parity suite
npm run serve     # http://localhost:4173
```

---

## Deployment

The site is deployed on Vercel at [safeguard-docs.vercel.app](https://safeguard-docs.vercel.app). `vercel.json` carries the static-site configuration and security headers.

---

## Live Stellar Testnet Deployments

The contracts are deployed on Stellar Testnet (`Test SDF Network ; September 2015`):

| Contract | Address / Contract ID |
| :--- | :--- |
| **Safeguard Payments Gateway** | `CBH4XG6K5XJHY3QMVUP7LGB4BFFG4C3XQ5Z64K7Z5OC66UDF4RAGRXYZ` |
| **Safeguard Policy Engine** | `CAQI3YI244YV7QGZ5VODUUGKFX6C4XNDQ2Y64K7Z5OC66UDF4RAGRP4V` |
| **Native SAC Token (SEP-41)** | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| **Governance Admin** | `GDIYQ7X5E22P3H75YQ7LOUXFX6C4XNDQ2Y64K7Z5OC66UDF4RAGRP4V` |

---

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md), [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md), and [`SECURITY.md`](SECURITY.md).

---

## License

Apache-2.0 — see [`LICENSE`](LICENSE).
