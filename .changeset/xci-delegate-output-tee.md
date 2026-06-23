---
"xci": patch
---

Fix: kind: xci now shows and logs the delegated command's output (tee to terminal + outer logfile), forwarding the output flag to the inner; piped+exit-event spawn preserves anti-hang on both normal and interrupt paths.
