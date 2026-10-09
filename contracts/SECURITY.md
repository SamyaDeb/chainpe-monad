# ChainPe Contracts on Monad — Security Notes

Scope: the custom ChainPe contracts deployed to Monad — `ChainPeRegistryUpgradeable`,
`PolicyVaultUpgradeable`, `ChainPeTimelock`. ChainPe does **not** deploy ERC-8004
registries on Monad; it links to the canonical Identity / Reputation registries. The
`erc8004/*` sources here are vendored reference implementations used only in tests.

## Static analysis (Slither)

Run per contract (the whole-project run trips on the duplicate `ERC1967Proxy` contract
name — OZ's vs. the vendored ERC-8004 one — a tooling quirk, not a code issue):

```bash
solc-select use 0.8.28
slither contracts/contracts/PolicyVaultUpgradeable.sol \
  --solc-remaps "@openzeppelin=node_modules/@openzeppelin" --exclude-dependencies
```

### Triage (from the pre-Monad review of the same contracts)

| Finding | Where | Disposition |
|---|---|---|
| `incorrect-exp`, `divide-before-multiply` | OZ `Math.sol` | Library code, false positive. |
| `unused-return` on `functionDelegateCall` | OZ `ERC1967Utils` | Library code. |
| `shadowing-local`: `owner` param shadows `Ownable.owner()` | PolicyVault `spend`/`previewSpend`/… | Accepted — matches the EIP-712 `Spend(address owner,…)` schema; `owner()` is never called there. |
| `block-timestamp` comparisons | PolicyVault expiry/deadline/daily cap | Accepted & required — windows are hours long. |
| `missing-zero-address-validation` on `identityRegistry_` | ChainPeRegistry | By design — `0` disables agent-link checks (deploy script defaults to the canonical registry). |

Re-run Slither on the Monad build before mainnet and add new findings here.

## Agent-identity links (new for Monad)

`register()` / `update()` only accept a non-zero `agentId` when the caller owns that
ERC-8004 agent or is approved for it (`ownerOf` / `isApprovedForAll` / `getApproved` on
the identity registry). This stops a listing from borrowing a reputable agent's id — and
its reputation. Limits:
- `agentId 0` means "unlinked", so the canonical agent #0 cannot be linked.
- The check runs at register/update time only. If the agent NFT is later transferred,
  the listing keeps its `agentId`; consumers (indexer, SDK) should re-check ownership.
- With `identityRegistry == address(0)` links are not checked; the deploy script refuses
  an identity registry address that has no code.

## Trust assumptions

- **USDC is centrally administered.** Circle can blacklist addresses and pause/upgrade the
  token. A blacklisted vault or recipient freezes the affected transfer.
- **Relayers (PolicyVault `spend`)** are permissionless and not forced to submit promptly;
  a held authorization is recovered by re-signing with a fresh `deadline`.
- **Owner** controls UUPS upgrades of both contracts and can therefore change vault logic.
  On mainnet the owner must be a `ChainPeTimelock` behind a multisig. The deploy scripts
  refuse a deployer-EOA owner on Monad mainnet unless `ALLOW_DEPLOYER_OWNER=true`.
- **Ownership transfer:** the registry uses `Ownable2Step` (new owner must
  `acceptOwnership()`); PolicyVault uses `Ownable`, so its `transferOwnership` takes effect
  immediately — double-check the target address.
- `withdraw` on PolicyVault is intentionally not pausable, so a pause can never trap funds.

## Monad-specific operational notes

- Gas is billed on the **gas limit**, not gas used; avoid padded gas limits in relayers.
- Accounts keep a **reserve balance** (default 10 MON); a relayer/deployer that dips below
  it can have transactions included that then revert (and still pay gas).

## Post-deploy checklist (Monad mainnet)

- [ ] Professional audit + bug bounty before meaningful TVL.
- [ ] Deploy `ChainPeTimelock` (24–48h delay), proposers = Safe (`npm run deploy:timelock:mainnet`).
- [ ] Deploy registry + vault with `OWNER_ADDRESS=<timelock>`.
- [ ] `npm run postcheck:mainnet` — fee token = USDC, identity registry = canonical ERC-8004.
- [ ] `npm run verify:mainnet`.
- [ ] Mainnet-fork rehearsal: deposit → setPolicy → relayed spend → withdraw → pause →
      upgrade through the timelock.
