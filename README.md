# coc-ts

TypeScript 7+ language features for coc.nvim.

This extension intentionally targets TypeScript 7 and newer. For TypeScript 6 and older, use `coc-tsserver`.

## Hover

Repeat `:call CocActionAsync('doHover')` at the same position to expand type definitions one level at a time. When the server can expand further, the hover includes a hint. After the final level, the next hover returns to the original type display. Hovering at a different position, editing or closing the current document, or restarting the server resets expansion.

This uses TypeScript's experimental hover verbosity protocol, verified with TypeScript 7.0.2. Servers without expansion support keep ordinary hover behavior. All hover queries, including `getHover` and `definitionHover`, share the expansion state.

## Configuration

- `ts.enable`: enable the extension.
- `ts.tsdk`: path to a TypeScript 7+ package or its `lib` directory.
- `ts.goMemLimit`: optional `GOMEMLIMIT` value for the TypeScript process.

## Commands

- `:CocCommand ts.restart`
- `:CocCommand ts.goToSourceDefinition`
- `:CocCommand ts.sortImports`
- `:CocCommand ts.removeUnusedImports`
