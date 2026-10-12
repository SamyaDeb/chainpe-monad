#!/usr/bin/env python3
"""Builds apps/marketplace/public/landing.html from the Claude Design export.

    python3 design/patch-landing.py

Reads  design/ChainPe Monad Landing main.html  (the export, untouched)
Writes apps/marketplace/public/landing.html     (the page that is served at /)

The export is a bundle: its page template is a JSON string inside <script type="__bundler/template">.
We decode it, apply the plain-string patches below (each one asserts that it matched), and write it back.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "design" / "ChainPe Monad Landing main.html"
DST = ROOT / "apps" / "marketplace" / "public" / "landing.html"
REPO = "https://github.com/SamyaDeb/chainpe-monad"

text = SRC.read_text()
m = re.search(r'(<script type="__bundler/template">)(.*?)(</script>)', text, re.S)
tpl = json.loads(m.group(2))


def sub(old, new, regex=False):
    global tpl
    n = len(re.findall(old, tpl)) if regex else tpl.count(old)
    assert n >= 1, f"patch did not match: {old[:70]!r}"
    tpl = re.sub(old, new, tpl) if regex else tpl.replace(old, new)


# --- honesty: remove links to things that do not exist, replace what is not integrated -------------------------
sub(r'\s*<a href="#"[^>]*>X \(Twitter\)</a>', "", regex=True)
sub(r'\s*<a href="#"[^>]*>Discord</a>', "", regex=True)
sub(r'(<a href=")#("[^>]*>)Privacy Policy', r"\1" + REPO + r"/blob/main/LICENSE\2MIT License", regex=True)
sub(r'(<a href=")#("[^>]*>)Terms of Service', r"\1" + REPO + r"/blob/main/PRIOR_WORK.md\2Prior work &amp; AI disclosure", regex=True)
sub(r'(<a href=")#("[^>]*>Vercel AI SDK)', r"\1" + REPO + r"/tree/main/packages/chainpe-ai-tools\2", regex=True)
sub("https://chainpe-monad-marketplace.vercel.app", "/services")
sub("['MetaMask', 'Wallet']", "['Sourcify', 'Verification']")

# --- live status instead of a hardcoded "Live" / "All operational" ----------------------------------------------
sub("clock: '', p: 0,", "clock: '', status: null, p: 0,")
sub("    this.resetStepTimer();\n    this.setupCounters();",
    "    this.resetStepTimer();\n    fetch('/api/status').then(r => r.ok ? r.json() : null).then(j => j && this.setState({ status: j })).catch(() => {});\n    this.setupCounters();")
sub("infraRows: INFRA.map((r, i) => ({ ...r,",
    "infraRows: INFRA.map((r, i) => ({ ...r, val: (r.name.indexOf('Railway (Facilitator)') === 0 ? label(s.status && s.status.facilitator) : r.name.indexOf('Railway (Indexer)') === 0 ? label(s.status && s.status.indexer) : r.val),")
sub("const COPY_PATH =",
    "const label = v => (v === 'live' ? 'Live' : v === 'degraded' ? 'Degraded' : v === 'down' ? 'Unreachable' : 'Checking…');\nconst COPY_PATH =")
sub(">All operational</span>", ">{{ statusText }}</span>")
sub("clock: s.clock,",
    "clock: s.clock,\n      statusText: s.status && (s.status.indexer !== 'live' || s.status.facilitator !== 'live') ? 'Check services' : 'All operational',")
sub("m3: Math.floor(9 * p)", "m3: Math.floor(((s.status && s.status.services) || 13) * p)")

# --- phones: the two code windows had a fixed 32px padding that leaves ~270px on a 390px screen ----------------
sub(r"(<div style=\")padding:32px(;font-family:'JetBrains Mono',monospace;font-size:14px;[^\"]*overflow-x:auto\">\{\{ (?:stepCode|devCode) \}\}</div>)",
    r"\1padding:clamp(16px,4vw,32px)\2", regex=True)

out = json.dumps(tpl, ensure_ascii=False).replace("</", "<\\u002F")
new = text[: m.start(2)] + out + text[m.end(2):]
DST.write_text(new)
assert json.loads(re.search(r'<script type="__bundler/template">(.*?)</script>', DST.read_text(), re.S).group(1)) == tpl
print(f"wrote {DST.relative_to(ROOT)} ({len(new):,} bytes)")
