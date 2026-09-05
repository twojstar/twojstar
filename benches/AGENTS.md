# Benches workspace

Codebench, Docbench and Streambench share dependency installation and CI here,
but remain separate products and Cloudflare Workers.

- Run `npm ci` from `benches/`; keep one workspace `package-lock.json`.
- Keep project runtime dependencies in the owning workspace `package.json`.
- Prefer shared scripts only for genuinely common build mechanics.
- Do not merge Worker entry points or security boundaries merely to reduce files.
- Changes to shared workspace tooling must validate all three Benches.
- Product-only changes should run the owning workspace check.

Docbench remains local-first: preserve text/EOL fidelity, PDF bookmarks,
metadata and attachment integrity. Streambench relay changes must preserve its
constrained, non-open-proxy boundary. Codebench user payloads remain browser-only.
