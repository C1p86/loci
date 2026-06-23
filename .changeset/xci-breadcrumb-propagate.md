---
"xci": patch
---

kind:xci now propagates the breadcrumb across the delegate boundary so the inner xci shows the full path from the original alias down to the current step in step headers and the run header (e.g. `run-child > inner-seq > inner-step`). No-delegation behavior is byte-identical: when XCI_BREADCRUMB is absent the run header is unchanged.
