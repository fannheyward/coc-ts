import type { ExtensionContext } from "coc.nvim";
import { workspace } from "coc.nvim";
import fs from "fs";
import path from "path";

export interface TypeScriptExecutable {
  path: string;
  version: string;
  source: "configured" | "workspace" | "bundled";
}

interface PackageJson {
  name?: unknown;
  version?: unknown;
  bin?: unknown;
}

const typescriptPackage = "typescript";

export async function resolveTypeScript(context: ExtensionContext): Promise<TypeScriptExecutable> {
  const config = workspace.getConfiguration("ts");
  const configuredTsdk = config.get<string>("tsdk", "").trim();
  if (configuredTsdk) {
    const resolved = await resolveTsdkPathToExe(configuredTsdk, "configured");
    if (!resolved) {
      throw new Error(`Configured ts.tsdk does not contain TypeScript 7: ${configuredTsdk}`);
    }
    return resolved;
  }

  for (const folder of workspace.folderPaths ?? []) {
    const resolved = await resolvePackagePath(
      path.join(folder, "node_modules", typescriptPackage),
      "workspace",
    );
    if (resolved) {
      return resolved;
    }
  }

  const bundled = await resolvePackagePath(
    context.asAbsolutePath(path.join("node_modules", typescriptPackage)),
    "bundled",
  );
  if (bundled) {
    return bundled;
  }

  throw new Error(
    "Unable to find TypeScript 7. Install typescript@^7, set ts.tsdk, or reinstall coc-ts.",
  );
}

async function resolveTsdkPathToExe(
  input: string,
  source: TypeScriptExecutable["source"],
): Promise<TypeScriptExecutable | undefined> {
  const resolved = normalizeConfiguredPath(input);
  if (await isFile(resolved)) {
    const version = await findTypeScriptPackageVersion(path.dirname(resolved));
    if (version && isVersionSevenOrNewer(version)) {
      return {
        path: withLongPathPrefix(resolved),
        version,
        source,
      };
    }
    return undefined;
  }

  const candidateDirs = unique(
    [resolved, path.join(resolved, ".."), path.join(resolved, "..", "..")].map((p) =>
      path.normalize(p),
    ),
  );

  for (const dir of candidateDirs) {
    const pkg = await resolvePackagePath(dir, source);
    if (pkg) {
      return pkg;
    }
  }

  return undefined;
}

async function resolvePackagePath(
  packagePath: string,
  source: TypeScriptExecutable["source"],
): Promise<TypeScriptExecutable | undefined> {
  const packageJson = await readPackageJson(path.join(packagePath, "package.json"));
  if (!packageJson) {
    return undefined;
  }

  const name = typeof packageJson.name === "string" ? packageJson.name : "";
  const version = typeof packageJson.version === "string" ? packageJson.version : "unknown";
  if (name !== typescriptPackage || !isVersionSevenOrNewer(version)) {
    return undefined;
  }

  const platformExe = path.join(platformPackagePath(packagePath), "lib", executableName());
  if (await isFile(platformExe)) {
    return { path: withLongPathPrefix(platformExe), version, source };
  }

  const bin = isRecord(packageJson.bin) ? packageJson.bin : {};
  const binPath =
    typeof bin.tsc === "string"
      ? path.join(packagePath, bin.tsc)
      : path.join(packagePath, "bin", "tsc");
  if (await isFile(binPath)) {
    return { path: withLongPathPrefix(binPath), version, source };
  }

  return undefined;
}

function normalizeConfiguredPath(value: string): string {
  const expanded = workspace.expand(value.trim());
  return path.normalize(
    path.isAbsolute(expanded) ? expanded : path.join(workspace.root || process.cwd(), expanded),
  );
}

function platformPackagePath(packagePath: string): string {
  return path.join(
    packagePath,
    "..",
    "@typescript",
    `typescript-${process.platform}-${process.arch}`,
  );
}

function executableName(): string {
  return process.platform === "win32" ? "tsc.exe" : "tsc";
}

async function findTypeScriptPackageVersion(startDir: string): Promise<string | undefined> {
  let current = path.resolve(startDir);
  for (;;) {
    const packageJson = await readPackageJson(path.join(current, "package.json"));
    if (
      packageJson &&
      packageJson.name === typescriptPackage &&
      typeof packageJson.version === "string"
    ) {
      return packageJson.version;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

async function readPackageJson(file: string): Promise<PackageJson | undefined> {
  try {
    return JSON.parse(await fs.promises.readFile(file, "utf8")) as PackageJson;
  } catch {
    return undefined;
  }
}

async function isFile(file: string): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(file);
    return stat.isFile();
  } catch {
    return false;
  }
}

function isVersionSevenOrNewer(version: string): boolean {
  const major = /^(\d+)(?:\.|$)/.exec(version)?.[1];
  return major !== undefined && Number(major) >= 7;
}

function withLongPathPrefix(exePath: string): string {
  if (process.platform === "win32" && exePath.length >= 248 && !exePath.startsWith("\\\\?\\")) {
    return `\\\\?\\${exePath}`;
  }
  return exePath;
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
