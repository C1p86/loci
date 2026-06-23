---
"xci": patch
---

Security fix: secret values are now redacted as substrings within argv tokens and cwd strings (e.g. `token=${DEPLOY_TOKEN}` renders `token=***`), not only as whole-token exact matches. Closes a cleartext secret leak in the delegation banner, run header, dry-run, and verbose output.
