import type {
  DocumentSelector,
  ExtensionContext,
  IServiceProvider,
  LanguageClientOptions,
  OutputChannel,
  ServerOptions,
} from "coc.nvim";
import {
  CancellationToken,
  Disposable,
  Emitter,
  Event,
  LanguageClient,
  LocationLink,
  ServiceStat,
  State,
  commands,
  disposeAll,
  wait,
  window,
  workspace,
} from "coc.nvim";
import { createConfigurationMiddleware } from "./configuration";
import { TypeScriptExecutable, resolveTypeScript } from "./typescript";

const languageIds = [
  "typescript",
  "typescriptreact",
  "typescript.tsx",
  "typescript.jsx",
  "javascript",
  "javascriptreact",
  "javascript.jsx",
];
const codeLensShowLocationsCommand = "ts.codeLens.showLocations";
const sourceDefinitionMethod = "custom/textDocument/sourceDefinition";

export interface CocTsApi {
  getCurrentTypeScript(): TypeScriptExecutable | undefined;
  initializeAPIConnection(pipe?: string): Promise<string>;
  restart(): Promise<void>;
}

export class TypeScriptService implements IServiceProvider {
  public readonly id = "coc-ts";
  public readonly name = "coc-ts";
  public selector: DocumentSelector = createDocumentSelector();
  public client: LanguageClient | undefined;

  private stateValue = ServiceStat.Initial;
  private readonly readyEmitter = new Emitter<void>();
  public readonly onServiceReady: Event<void> = this.readyEmitter.event;

  private readonly output: OutputChannel;
  private readonly sessionDisposables: Disposable[] = [];
  private currentTypeScript: TypeScriptExecutable | undefined;

  constructor(private readonly context: ExtensionContext) {
    this.output = window.createOutputChannel("coc-ts");
    this.context.subscriptions.push(this.output);
    this.registerCommands();
    this.registerConfigurationListener();
  }

  public get state(): ServiceStat {
    return this.stateValue;
  }

  public getCurrentTypeScript(): TypeScriptExecutable | undefined {
    return this.currentTypeScript;
  }

  public async initializeAPIConnection(pipe?: string): Promise<string> {
    const client = await this.getReadyClient();
    const result = await client.sendRequest<{ sessionId: string; pipe: string }>(
      "custom/initializeAPISession",
      {
        pipe,
      },
    );
    return result.pipe;
  }

  public async start(): Promise<void> {
    if (!this.enabled) {
      this.stateValue = ServiceStat.Stopped;
      return;
    }
    if (this.client || this.stateValue === ServiceStat.Starting) {
      return;
    }

    this.stateValue = ServiceStat.Starting;
    try {
      const exe = await resolveTypeScript(this.context);
      const client = createLanguageClient(exe, this.output);
      this.client = client;
      this.currentTypeScript = exe;
      this.output.appendLine(`Resolved TypeScript ${exe.version} from ${exe.source}: ${exe.path}`);

      this.sessionDisposables.push(
        client,
        client.onDidChangeState((event) => {
          this.stateValue = toServiceState(event.newState);
        }),
      );

      await client.start();
      this.stateValue = ServiceStat.Running;
      this.readyEmitter.fire();
    } catch (error) {
      this.stateValue = ServiceStat.StartFailed;
      this.output.appendLine(
        `Failed to start TypeScript language server: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  public async restart(): Promise<void> {
    if (!this.enabled) {
      await this.stop();
      return;
    }
    await this.stop();
    await this.start();
  }

  public async stop(): Promise<void> {
    const client = this.client;
    if (!client) {
      this.stateValue = ServiceStat.Stopped;
      return;
    }

    this.stateValue = ServiceStat.Stopping;
    this.client = undefined;
    this.currentTypeScript = undefined;
    try {
      if (client.needsStop()) {
        await client.stop();
      }
      await wait(30);
    } finally {
      disposeAll(this.sessionDisposables);
      this.sessionDisposables.length = 0;
      this.stateValue = ServiceStat.Stopped;
    }
  }

  public dispose(): void {
    void this.stop();
    this.readyEmitter.dispose();
  }

  private async getReadyClient(): Promise<LanguageClient> {
    if (!this.client || this.stateValue !== ServiceStat.Running) {
      await this.start();
    }
    if (!this.client) {
      throw new Error("coc-ts language server is not running.");
    }
    await this.client.onReady();
    return this.client;
  }

  private registerCommands(): void {
    this.context.subscriptions.push(
      commands.registerCommand("ts.restart", () => this.restart()),
      commands.registerCommand("ts.goToSourceDefinition", () => this.goToSourceDefinition()),
      commands.registerCommand("ts.sortImports", () =>
        this.executeSourceAction("source.sortImports"),
      ),
      commands.registerCommand("ts.removeUnusedImports", () =>
        this.executeSourceAction("source.removeUnusedImports"),
      ),
      commands.registerCommand(
        codeLensShowLocationsCommand,
        (...args: unknown[]) => this.showCodeLensLocations(args),
        undefined,
        true,
      ),
    );
  }

  private registerConfigurationListener(): void {
    this.context.subscriptions.push(
      workspace.onDidChangeConfiguration((event) => {
        const enabledChanged = event.affectsConfiguration("ts.enable");
        if (enabledChanged) {
          if (this.enabled) {
            void this.start();
          } else {
            void this.stop();
          }
          return;
        }

        const restartKeys = ["ts.tsdk", "ts.goMemLimit"];
        if (this.client && restartKeys.some((key) => event.affectsConfiguration(key))) {
          void this.restart();
        }
      }),
    );
  }

  private async goToSourceDefinition(): Promise<void> {
    const client = await this.getReadyClient();
    const state = await workspace.getCurrentState();
    if (!state || !languageIds.includes(state.document.languageId)) {
      void window.showWarningMessage(
        "Source definition is only available for JavaScript and TypeScript documents.",
      );
      return;
    }

    const response = await client.sendRequest<any>(
      sourceDefinitionMethod,
      {
        textDocument: { uri: state.document.uri },
        position: state.position,
      },
      CancellationToken.None,
    );
    const locations = normalizeLocations(response);
    if (locations.length === 0) {
      void window.showWarningMessage("No source definitions found.");
      return;
    }
    await workspace.showLocations(locations);
  }

  private async executeSourceAction(kind: string): Promise<void> {
    await this.getReadyClient();
    const state = await workspace.getCurrentState();
    if (!state || !languageIds.includes(state.document.languageId)) {
      void window.showWarningMessage(
        "This command is only available for JavaScript and TypeScript documents.",
      );
      return;
    }

    const doc = workspace.getDocument(state.document.uri);
    if (!doc) {
      return;
    }
    await commands.executeCommand("editor.action.executeCodeActions", doc, undefined, [kind], 3000);
  }

  private async showCodeLensLocations(args: unknown[]): Promise<void> {
    if (args.length !== 3) {
      throw new Error("Unexpected code lens arguments.");
    }
    const locations = normalizeLocations(args[2]);
    if (locations.length > 0) {
      await workspace.showLocations(locations);
    }
  }

  private get enabled(): boolean {
    return workspace.getConfiguration("ts").get<boolean>("enable", true);
  }
}

function createLanguageClient(exe: TypeScriptExecutable, output: OutputChannel): LanguageClient {
  const config = workspace.getConfiguration("ts");

  const env = { ...process.env };
  const goMemLimit = config.get<string>("goMemLimit", "").trim();
  if (goMemLimit) {
    if (/^[0-9]+(([KMGT]i)?B)?$/.test(goMemLimit)) {
      env.GOMEMLIMIT = goMemLimit;
    } else {
      output.appendLine(`Invalid ts.goMemLimit ignored: ${goMemLimit}`);
    }
  }

  const executable = {
    command: exe.path,
    args: ["--lsp", "--stdio"],
    options: {
      cwd: workspace.root || process.cwd(),
      env,
    },
  };
  const serverOptions: ServerOptions = {
    run: executable,
    debug: executable,
  };

  const middleware = createConfigurationMiddleware();
  middleware.didOpen = (textDocument, next) => {
    Object.assign(textDocument, { languageId: normalizeLanguageId(textDocument.languageId) });
    return next(textDocument);
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: createDocumentSelector(),
    diagnosticCollectionName: "coc-ts",
    outputChannel: output,
    synchronize: {
      configurationSection: ["js/ts", "typescript", "javascript", "ts"],
    },
    initializationOptions: {
      codeLensShowLocationsCommandName: codeLensShowLocationsCommand,
      enableTelemetry: false,
    },
    diagnosticPullOptions: {
      onChange: true,
      onSave: true,
      onFocus: true,
    },
    middleware,
  };

  return new LanguageClient("coc-ts", "TypeScript", serverOptions, clientOptions);
}

function normalizeLanguageId(languageId: string): string {
  switch (languageId) {
    case "typescript.tsx":
    case "typescript.jsx":
      return "typescriptreact";
    case "javascript.jsx":
      return "javascriptreact";
    default:
      return languageId;
  }
}

function createDocumentSelector(): DocumentSelector {
  const schemes = ["file", "untitled"];
  return languageIds.flatMap((language) => schemes.map((scheme) => ({ language, scheme })));
}

function normalizeLocations(response: any): Array<{ uri: string; range: any; targetRange?: any }> {
  if (!response) {
    return [];
  }
  const items = Array.isArray(response) ? response : [response];
  return items.map((item) => {
    if (LocationLink.is(item)) {
      return {
        uri: item.targetUri,
        range: item.targetSelectionRange,
        targetRange: item.targetRange,
      };
    }
    return item;
  });
}

function toServiceState(state: State): ServiceStat {
  switch (state) {
    case State.Running:
      return ServiceStat.Running;
    case State.Starting:
      return ServiceStat.Starting;
    case State.StartFailed:
      return ServiceStat.StartFailed;
    case State.Stopped:
      return ServiceStat.Stopped;
    default:
      return ServiceStat.Initial;
  }
}
