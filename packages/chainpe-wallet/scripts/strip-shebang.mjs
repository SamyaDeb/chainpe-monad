// Removes the "#!/usr/bin/env node" line from a bundled file, byte-safe (used by build-mcpb.ps1,
// because PowerShell's Get-Content/Set-Content can mangle encodings on Windows PowerShell 5).
import { readFileSync, writeFileSync } from 'node:fs'
const file = process.argv[2]
if (!file) throw new Error('usage: node strip-shebang.mjs <file>')
writeFileSync(file, readFileSync(file, 'utf8').replace(/^#!.*\r?\n?/, ''))
