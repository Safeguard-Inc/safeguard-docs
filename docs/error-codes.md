# Error codes

Every failure the Safeguard stack can produce has a stable identifier. This
page is the cross-layer index: which layer owns a code, what it means, and
where the authoritative table lives.

## The rule

**Codes are assign-only.** A code quoted in a stored record, a reverted
transaction, a log line or an incident report must never change meaning. So:

- a code is never renumbered, even to close a gap;
- a non-dense table stays non-dense — removed codes are never reissued;
- a removed variant keeps its number in a retired list rather than freeing it.

This is why the hook error table jumps from 5 to 8 and from 10 to 12. Gaps are
the evidence that the rule is being followed.

## Where codes live

| Layer | Codes | Authoritative source | Gate |
| ----- | ----- | -------------------- | ---- |
| Policy decision | `APPROVE` / `BLOCK` / `FLAG` + 11 reason codes | [`safeguard-policy` `crates/safeguard-core/src/decision.rs`](https://github.com/Safeguard-Inc/safeguard-policy/blob/main/crates/safeguard-core/src/decision.rs) | property tests + decision-schema parity test |
| Policy contract | 13 `ContractError` variants | [`safeguard-policy` `crates/safeguard-contract/src/error.rs`](https://github.com/Safeguard-Inc/safeguard-policy/blob/main/crates/safeguard-contract/src/error.rs) | contract test suite |
| Enforcement contract | 8 `ContractError` variants | [`safeguard-hooks` `contracts/compliance-hooks/src/lib.rs`](https://github.com/Safeguard-Inc/safeguard-hooks/blob/main/contracts/compliance-hooks/src/lib.rs) | reachability tests + [`docs/errors.md`](https://github.com/Safeguard-Inc/safeguard-hooks/blob/main/docs/errors.md) |
| Enforcement reasons | 7 `RejectionReason` variants | [`safeguard-hooks` `crates/hook-core/src/reason.rs`](https://github.com/Safeguard-Inc/safeguard-hooks/blob/main/crates/hook-core/src/reason.rs) | exhaustive `From` mapping (adding a reason without a code fails to compile) |
| Audit library | 100 registered codes | [`safeguard-audit` `errors/catalog.json`](https://github.com/Safeguard-Inc/safeguard-audit/blob/main/errors/catalog.json) | `scripts/error_catalog.py --check` in CI |

## Policy decision reason codes

Produced by the engine, carried in the decision document. These appear in
policy decisions and in audit records.

| Reason code | Decision | Produced when |
| ----------- | -------- | ------------- |
| `no_reason` | APPROVE | no rule triggered |
| `account_frozen` | BLOCK | account status is frozen (structural — carries no rule id) |
| `account_suspended` | BLOCK | account status is suspended (structural) |
| `account_restricted` | FLAG | account status is restricted (structural) |
| `account_status_unknown` | FLAG | status missing or unrecognized (fails closed) |
| `allowlist_required` | rule action | allowlist rule enabled and subject is not a member |
| `denylist_match` | rule action | subject matched the denylist |
| `sanctions_match` | rule action | sanctions screening produced a match |
| `jurisdiction_restricted` | rule action | region is on the restricted list |
| `jurisdiction_prohibited` | rule action | region is on the prohibited list |
| `jurisdiction_unknown` | rule action | region is in no list (fails closed) |

`rule action` is `BLOCK` or `FLAG` depending on how the rule was configured —
the reason code names the cause, the rule's action determines the severity.
Account-status outcomes are structural, so they never carry a rule id.

## Enforcement contract error codes

Reverted by the hooks contract. A caller sees these as `Error(Contract, #N)`.

| Code | Variant | Meaning |
| ---- | ------- | ------- |
| 2 | `UnboundToken` | the token the operation concerns is not bound to this contract |
| 3 | `PolicyDenied` | the configured policy denied an account |
| 4 | `AccountFrozen` | an account holding funds is frozen |
| 5 | `SpenderNotAuthorized` | the spender of a delegated flow is denied by policy; the spender holds no funds, so its denial is distinct from the fund-holders' denial |
| 8 | `SacAuthorizationFailed` | the underlying SAC authorization check failed or was unreachable |
| 9 | `InvalidConfiguration` | the contract configuration is invalid or absent |
| 10 | `PolicyUnavailable` | the policy contract could not be reached or evaluated (fail-closed) |
| 12 | `AlreadyInitialized` | `initialize` was called on an already-initialized contract |

Codes 1, 6, 7 and 11 are deliberately absent. They were removed in a
completeness audit because no code path could emit them — 1 was "unauthorized
caller" (the admin gate uses the host's `require_auth`, which reverts before
the contract returns), 6 and 7 were sanctions/jurisdiction distinctions that
are invisible on the `is_authorized -> bool` wire, and 11 was registration
state that does not exist on this contract. They are never reissued.

## Audit library codes

`safeguard-audit` registers its whole taxonomy — 100 variants across 14 enums
— in `errors/catalog.json`, each with a stable symbolic id (`SGA-…`), an
assigned numeric code and a one-line meaning lifted from the variant's own doc
comment. The generated table is at
[`safeguard-audit/docs/errors.md`](https://github.com/Safeguard-Inc/safeguard-audit/blob/main/docs/errors.md).

Codes are allocated in per-enum blocks of 100 from a base of 1000, so the
first two digits identify the enum block and the number stays legible in the
field.

The catalog is held to the source by `scripts/error_catalog.py`, which fails
CI on all four drift modes:

- a variant added without a catalog entry,
- a variant removed from source but left registered,
- a numeric code reused for a second variant,
- a `docs/errors.md` that no longer matches the catalog.

## Design notes

**Fail-closed is a code property, not a policy one.** An unknown account status
flags rather than approving; an unknown jurisdiction takes the rule's action,
which blocks under a blocking rule; an unreachable policy contract denies.
Junk input — an unrecognized status or region code — maps to the `Unknown`
variant rather than widening the outcome.

**The privacy rule constrains error content.** Error messages may carry
identifiers, which are public transaction metadata, but never confidential
values: no balances, ciphertexts, view keys or credentials. Where a useful
detail would expose protected data, the variant carries a stable code instead
and the detail stays out of the message.

**One code, one cause.** Every denial path maps to a distinct code. A code that
two different gates could emit makes an incident report ambiguous, which is the
situation these tables exist to prevent.
