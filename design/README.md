# Landing page design

The landing page at `/` is the team's **Claude Design** export, used as designed (not re-implemented).

| File | What it is |
|---|---|
| `ChainPe Monad Landing main.html` | The original export (a self-contained bundle: the design's runtime, React, fonts and the page template). Source of truth. |
| `Chainpe Monad Landing Page.pdf`, `… 2.pdf` | Earlier PDF exports (stills only). Kept for reference. |
| `../apps/marketplace/public/landing.html` | The page we serve: the export with a few patches (below). |

`next.config.mjs` rewrites `/` to `/landing.html`, with a CSP that allows the bundle's `blob:` scripts and fonts.

## Patches applied to the export

`python3 design/patch-landing.py` regenerates `apps/marketplace/public/landing.html` from the export; every patch asserts that it matched. They are text-only, except the code windows' padding, which is reduced on phones.

- Removed the **X (Twitter)** and **Discord** links and the **Privacy Policy / Terms of Service** links: those accounts and pages do not exist. The Legal column links to the MIT license and the prior-work disclosure instead.
- Replaced **MetaMask** (not integrated) with **Sourcify** in the ecosystem grid.
- The "Vercel AI SDK" footer link and the **Marketplace** links now point to the real package and to `/services`.
- The Network Status rows for the Railway services and the "All operational" label read `/api/status` (live health of the hosted indexer and facilitator) instead of a fixed "Live"; the "Demo agents" counter uses the indexer's service count.

## Re-exporting

Export the design again as HTML, replace `ChainPe Monad Landing main.html`, and re-apply the patches
(the list above; they are plain string replacements on the decoded template).
