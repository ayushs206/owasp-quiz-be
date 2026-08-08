## Summary

Describe the user-visible or developer-visible behavior changed by this pull request.

## Mandatory checklist

- [ ] I read `CLAUDE.md` and the relevant design documents before coding.
- [ ] This change follows the documented module structure and simplicity rules.
- [ ] API changes update `docs/openapi.yaml` and `docs/api-contract.md`.
- [ ] Database changes update Prisma migrations and `docs/database-design.md`.
- [ ] Lifecycle or architecture changes update the HLD and README.
- [ ] Authorization, ownership, enrollment, state, and expiry checks remain server-side.
- [ ] No correct answers, secrets, signed URLs, camera data, or sensitive request bodies are exposed or logged.
- [ ] Race conditions, idempotency, and N+1/query behavior were considered.
- [ ] Tests cover success and important failure paths.
- [ ] Formatting, lint, typecheck, tests, migration validation, build, and `git diff --check` pass as applicable.
- [ ] No Redis, queue, worker, microservice, custom auth, or speculative abstraction was added without explicit approval.

## Validation

List the commands run and their results.

## Contract and migration notes

State whether the API contract or database schema changed. Include migration and compatibility notes when relevant.
