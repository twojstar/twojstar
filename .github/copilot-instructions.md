# GitHub Copilot review baseline

Use the nearest applicable `AGENTS.md` when present; deeper instructions override broader ones. Apply matching path-specific `.github/instructions/*.instructions.md` files.

For code review:

- Focus on concrete regressions introduced by the PR: correctness, security/privacy, data loss, races/lifecycle/resource leaks, compatibility, and repository-contract violations.
- Treat CI, build, lint, and test failures as actionable only when caused by the diff.
- Avoid generic style or formatting comments already enforced by tooling unless they reveal a real defect.
- Do not nitpick docs-only or cosmetic changes unless they are factually wrong, break generated/validated content, or create security/release risk.
- Prefer one precise comment per root cause. State the impact and the smallest useful fix.
- If there are no actionable findings, do not invent nits or filler praise.
- Write review comments in concise English.