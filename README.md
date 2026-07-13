# coc-ts

TypeScript 7+ language features for coc.nvim.

This extension intentionally targets TypeScript 7 and newer. For TypeScript 6 and older, use `coc-tsserver`.

## Configuration

- `ts.enable`: enable the extension.
- `ts.tsdk`: path to a TypeScript 7+ package or its `lib` directory.
- `ts.goMemLimit`: optional `GOMEMLIMIT` value for the TypeScript process.

## Commands

- `:CocCommand ts.restart`
- `:CocCommand ts.goToSourceDefinition`
- `:CocCommand ts.sortImports`
- `:CocCommand ts.removeUnusedImports`
