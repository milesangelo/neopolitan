## Summary
<!-- Briefly explain what this PR changes and why. -->

## Type of Change
- [ ] Bug fix
- [ ] New feature / capability
- [ ] Provider adapter or dialect flavor update
- [ ] Documentation / tests / CI

## Verification Checklist
- [ ] `pnpm run format:check && pnpm run lint` passes
- [ ] `pnpm run check:boundaries` passes
- [ ] `pnpm run typecheck` passes
- [ ] `pnpm run test:coverage` passes all coverage thresholds
- [ ] `pnpm run test:packed` passes (`publint`, `attw`, external consumer E2E)
- [ ] Added/updated tests and/or `tests/fixtures/*.jsonl` golden wire fixtures (without billed live LLM calls)
- [ ] Added a Changeset (`pnpm changeset`) if publishing package changes
