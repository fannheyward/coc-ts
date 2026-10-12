# Verbose hover

## Problem and approach

Repeated hover at the same document version and position should expand TypeScript types one level at a time. TypeScript performs expansion; coc-ts tracks the next level and keeps coc.nvim's existing hover rendering.

Register `experimental.hoverVerbosityLevel` before client startup, merging existing experimental capabilities. Add `provideHover` middleware that sends a URI-only document identifier and `verbosityLevel`. Advance only after the latest successful, uncancelled response reports `canIncreaseVerbosity`. Reset after the final level, when the context changes, when the document closes, and when the client stops.

Cancelled or superseded responses must not change the level or appear as current hover results. Preserve coc.nvim's failed-request handling. Append an expansion hint only to Markdown responses, preserving the range and other content formats.

## Scope and risks

- Modify `src/client.ts`, add `src/hover.ts`, and document the behavior in `README.md`.
- No new commands, configuration, dependencies, or changes to coc.nvim.
- All callers of the hover provider, including `getHover` and `definitionHover`, share expansion state. Document this behavior.
- The protocol is experimental. Missing expansion flags keep requests at level 0; do not assume all TypeScript 7 versions implement the extension.

## Steps and acceptance

- [x] Write regression checks before implementation for level cycling, context changes, cancellation, response ordering, request errors, content formats, and lifecycle reset.
- [x] Implement middleware and register it for each new LanguageClient.
- [x] Verify the middleware against the installed TypeScript 7.0.2 LSP server. The verification covered nested type expansion, cycling, and changed document content.
- [x] Run tests, typecheck, build, lint, and format checks; inspect the complete diff. All 14 tests pass, including the real-server check. `npm run typecheck`, `npm run build`, `npm run lint`, `npm run format:check`, and `git diff --check` pass.
- [x] De-review removed forwarding of nonexistent prior `didChange` and `didClose` middleware. Temporary behavior checks and real TypeScript 7.0.2 LSP checks passed before and after removal; typecheck, build, lint, and formatting passed afterward. The index was preserved.

The test file and `npm test` script were removed at the user's request after verification. The results above record the completed checks before removal.

Vim/Neovim float interaction requires a host session and remains a separate manual check.

## References

- https://github.com/neoclide/coc.nvim/discussions/5772
- https://github.com/microsoft/typescript-go/commit/221106cbd621abb6a09de94dc35482704430b3b8
