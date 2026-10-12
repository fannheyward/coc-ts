import type { Hover, LanguageClient } from "coc.nvim";

interface VerboseHover extends Hover {
  canIncreaseVerbosity?: boolean;
}

export function registerHoverFeature(client: LanguageClient): void {
  let context: { uri: string; version: number; line: number; character: number } | undefined;
  let nextLevel = 0;
  let requestId = 0;

  const reset = () => {
    context = undefined;
    nextLevel = 0;
    requestId += 1;
  };

  client.middleware.provideHover = async (document, position, token) => {
    if (token.isCancellationRequested) {
      return null;
    }
    if (
      !context ||
      context.uri !== document.uri ||
      context.version !== document.version ||
      context.line !== position.line ||
      context.character !== position.character
    ) {
      context = { uri: document.uri, version: document.version, ...position };
      nextLevel = 0;
    }
    const id = ++requestId;
    const level = nextLevel;
    let response: VerboseHover | null;
    try {
      response = await client.sendRequest<VerboseHover | null>(
        "textDocument/hover",
        { textDocument: { uri: document.uri }, position, verbosityLevel: level },
        token,
      );
    } catch (error) {
      if (id !== requestId) {
        return null;
      }
      return client.handleFailedRequest({ method: "textDocument/hover" }, token, error, null);
    }
    if (token.isCancellationRequested || id !== requestId) {
      return null;
    }

    nextLevel = response?.canIncreaseVerbosity === true ? level + 1 : 0;
    const contents = response?.contents;
    if (
      response?.canIncreaseVerbosity === true &&
      typeof contents === "object" &&
      !Array.isArray(contents) &&
      "kind" in contents &&
      contents.kind === "markdown"
    ) {
      return {
        ...response,
        contents: { ...contents, value: `${contents.value}\n\n_Hover again to expand._` },
      };
    }
    return response;
  };

  client.middleware.didChange = (params, next) => {
    if (context?.uri === params.textDocument.uri) {
      reset();
    }
    return next(params);
  };
  client.middleware.didClose = (document, next) => {
    if (context?.uri === document.uri) {
      reset();
    }
    return next(document);
  };

  client.registerFeature({
    fillClientCapabilities(capabilities: { experimental?: unknown }) {
      capabilities.experimental = {
        ...(typeof capabilities.experimental === "object" && capabilities.experimental !== null
          ? capabilities.experimental
          : {}),
        hoverVerbosityLevel: true,
      };
    },
    initialize() {},
    dispose: reset,
  });
}
