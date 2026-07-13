import type { ExtensionContext } from "coc.nvim";
import { services } from "coc.nvim";
import { CocTsApi, TypeScriptService } from "./client";

export async function activate(context: ExtensionContext): Promise<CocTsApi> {
  const service = new TypeScriptService(context);
  context.subscriptions.push(services.register(service));

  return {
    getCurrentTypeScript: () => service.getCurrentTypeScript(),
    initializeAPIConnection: (pipe?: string) => service.initializeAPIConnection(pipe),
    restart: () => service.restart(),
  };
}
