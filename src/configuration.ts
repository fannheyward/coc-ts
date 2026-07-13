import type { LanguageClientOptions } from "coc.nvim";
import { workspace } from "coc.nvim";

const configSections = ["js/ts", "typescript", "javascript"];
const protectedKeys = new Set(["__proto__", "constructor", "prototype"]);

export function createConfigurationMiddleware(): NonNullable<LanguageClientOptions["middleware"]> {
  return {
    workspace: {
      async configuration(params: any, token: any, next: any): Promise<any[]> {
        const hasOtherSections = params.items.some((item: { section?: string }) => {
          return item.section === undefined || !configSections.includes(item.section);
        });
        const defaults = hasOtherSections ? await next(params, token) : [];
        const cache = new Map<string, Record<string, unknown>>();

        return params.items.map((item: { section?: string; scopeUri?: string }, index: number) => {
          if (item.section === undefined || !configSections.includes(item.section)) {
            return defaults[index] ?? null;
          }
          const key = item.scopeUri ?? "";
          let merged = cache.get(key);
          if (!merged) {
            merged = getMergedConfiguration(item.scopeUri);
            cache.set(key, merged);
          }
          return merged;
        });
      },
    },
    sendNotification(type: any, next: any, params: any): Promise<void> {
      const method = typeof type === "string" ? type : type.method;
      if (method === "workspace/didChangeConfiguration") {
        const merged = getMergedConfiguration(undefined);
        const settings: Record<string, unknown> = Object.create(null);
        for (const section of configSections) {
          settings[section] = merged;
        }
        return next(type, { settings });
      }
      return next(type, params);
    },
  };
}

function getMergedConfiguration(resource: string | undefined): Record<string, unknown> {
  let merged: Record<string, unknown> = Object.create(null);
  for (const section of [...configSections].reverse()) {
    merged = deepMerge(merged, readSection(section, resource));
  }
  return merged;
}

function readSection(section: string, resource: string | undefined): Record<string, unknown> {
  const config = workspace.getConfiguration(section, resource);
  return toPlainObject(config);
}

function toPlainObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return Object.create(null);
  }

  const result: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(value)) {
    if (protectedKeys.has(key)) {
      continue;
    }
    const child = (value as Record<string, unknown>)[key];
    if (typeof child === "function") {
      continue;
    }
    result[key] = toJsonValue(child);
  }
  return result;
}

function toJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(toJsonValue);
  }
  if (typeof value === "object" && value !== null) {
    return toPlainObject(value);
  }
  return value;
}

function deepMerge(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(a)) {
    result[key] = a[key];
  }
  for (const key of Object.keys(b)) {
    if (protectedKeys.has(key)) {
      continue;
    }
    const left = result[key];
    const right = b[key];
    if (isRecord(left) && isRecord(right)) {
      result[key] = deepMerge(left, right);
    } else {
      result[key] = right;
    }
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
