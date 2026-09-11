# Security Policy

## Supported versions

`main` is supported. Older commits are not patched.

## Reporting a vulnerability

Open a **private security advisory** on GitHub (Security → Advisories).
Do not open a public issue for vulnerabilities. Include:

- affected path (`collab/` and/or `workspace/`) and commit SHA,
- reproduction steps (redacted credentials),
- impact assessment if known.

We aim to acknowledge within 72 hours.

## Out of scope

- Secrets handling of your own deployment (`.env` contents, JWT secrets,
  service tokens) — these are never part of this repository by design.
- Upstream dependencies (see `Cargo.lock` / `package-lock.json`); report
  upstream CVEs to their maintainers unless the wiring here is at fault.
