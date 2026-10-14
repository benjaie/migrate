import { constants } from "fs";
import * as fsp from "fs/promises";
import * as JSON5 from "json5";
import { dirname, resolve } from "path";
import { parse } from "pg-connection-string";
import { pathToFileURL } from "url";

import { legacySettingsToPreset } from "../config";
import { Settings } from "../settings";

// Jest 29 does not understand package export subpaths; resolving from the main
// package keeps this compatible with it whilst still using graphile-config's
// canonical loader.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { loadConfig } = require(resolve(
  dirname(require.resolve("graphile-config")),
  "loadConfig.js",
)) as {
  loadConfig(configPath?: string | null): Promise<GraphileConfig.Preset | null>;
};

export const DEFAULT_GMRC_PATH = `${process.cwd()}/.gmrc`;
export const DEFAULT_GMRCJS_PATH = `${DEFAULT_GMRC_PATH}.js`;
export const DEFAULT_GMRC_COMMONJS_PATH = `${DEFAULT_GMRC_PATH}.cjs`;

/**
 * Represents the option flags that are valid for all commands (see
 * src/cli.ts).
 */
export interface CommonArgv {
  /**
   * Optional path to the gmrc file.
   */
  config?: string;
}

export async function exists(path: string): Promise<boolean> {
  try {
    await fsp.access(path, constants.F_OK /* visible to us */);
    return true;
  } catch {
    return false;
  }
}

export async function getSettingsFromJSON(path: string): Promise<Settings> {
  let data;
  try {
    data = await fsp.readFile(path, "utf8");
  } catch (e) {
    throw new Error(
      `Failed to read '${path}': ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    );
  }
  try {
    return JSON5.parse(data);
  } catch (e) {
    throw new Error(
      `Failed to parse '${path}': ${
        e instanceof Error ? e.message : String(e)
      }`,
      { cause: e },
    );
  }
}

/**
 * Options passed to the getSettings function.
 */
interface Options {
  /**
   * Optional path to the gmrc config path to use; if not provided we'll fall
   * back to `./.gmrc` and `./.gmrc.js`.
   *
   * This must be the full path, including extension. If the extension is `.js`
   * then we'll use `require` to import it, otherwise we'll read it as JSON5.
   */
  configFile?: string;
}

/**
 * Loads the project's Graphile Config preset. A legacy gmrc is supported as a
 * deprecated fallback and converted into an equivalent preset.
 */
export async function getSettings(
  options: Options = {},
): Promise<GraphileConfig.Preset> {
  const { configFile } = options;
  const tryRequire = async (path: string): Promise<Settings> => {
    // If the file is e.g. `foo.js` then Node `require('foo.js')` would look in
    // `node_modules`; we don't want this - instead force it to be a relative
    // path.
    const rawRelativePath = pathToFileURL(resolve(process.cwd(), path)).href;

    // The tests need to not use `file://` URLs otherwise mock-fs doesn't work.
    const relativePath = rawRelativePath.startsWith("file:///")
      ? rawRelativePath.slice("file://".length)
      : rawRelativePath;

    try {
      const module = (await import(relativePath)) as Record<string, unknown>;
      return module.default ?? module;
    } catch (e) {
      throw new Error(
        `Failed to import '${relativePath}'; error:\n    ${
          e instanceof Error && e.stack
            ? e.stack.replace(/\n/g, "\n    ")
            : String(e)
        }`,
        { cause: e },
      );
    }
  };

  const legacyPreset = legacySettingsToPreset;
  const warnGmrcDeprecation = () => {
    // eslint-disable-next-line no-console
    console.warn(
      "[graphile-migrate] .gmrc is deprecated; move its settings to the `migrate` scope of graphile.config.*.",
    );
  };

  if (configFile != null) {
    if (!(await exists(configFile))) {
      throw new Error(`Failed to import '${configFile}': file not found`);
    }

    if (isLegacyConfigPath(configFile)) {
      warnGmrcDeprecation();
      if (configFile.endsWith(".js") || configFile.endsWith(".cjs")) {
        return legacyPreset(await tryRequire(configFile));
      } else {
        return legacyPreset(await getSettingsFromJSON(configFile));
      }
    } else {
      const preset = await loadConfig(configFile);
      if (!preset) {
        throw new Error(`Failed to import '${configFile}': file not found`);
      }
      return preset;
    }
  }

  const preset = await loadConfig();
  if (preset) {
    return preset;
  } else if (await exists(DEFAULT_GMRC_PATH)) {
    warnGmrcDeprecation();
    return legacyPreset(await getSettingsFromJSON(DEFAULT_GMRC_PATH));
  } else if (await exists(DEFAULT_GMRCJS_PATH)) {
    warnGmrcDeprecation();
    return legacyPreset(await tryRequire(DEFAULT_GMRCJS_PATH));
  } else if (await exists(DEFAULT_GMRC_COMMONJS_PATH)) {
    warnGmrcDeprecation();
    return legacyPreset(await tryRequire(DEFAULT_GMRC_COMMONJS_PATH));
  } else {
    throw new Error(
      "No .gmrc file found; please run `graphile-migrate init` first.",
    );
  }
}

function isLegacyConfigPath(configFile: string): boolean {
  const basename = configFile.split(/[\\/]/).pop();
  if (basename?.includes("gmrc")) return true;
  // Historically --config accepted arbitrary JSON5 filenames. Retain that
  // behaviour; named JavaScript/TypeScript configs are Graphile Config.
  return !/\.(?:[cm]?[jt]sx?)$/.test(configFile);
}

export async function readFileOrStdin(file: unknown): Promise<{
  filename: string;
  content: string;
}> {
  if (file != null) {
    if (typeof file === "string") {
      const filename = resolve(file);
      const content = await fsp.readFile(filename, "utf8");
      return { filename, content };
    } else {
      throw new Error(`Unexpected value for "file" flag`);
    }
  } else {
    return { filename: "stdin", content: await readStdin() };
  }
}

export function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");

    process.stdin.on("error", reject);
    process.stdin.on("readable", () => {
      let chunk;
      // Use a loop to make sure we read all available data.
      while ((chunk = process.stdin.read() as string | null) !== null) {
        data += chunk;
      }
    });

    process.stdin.on("end", () => {
      resolve(data);
    });
  });
}

export function getDatabaseName(connectionString: string): string {
  const databaseName = parse(connectionString).database;
  if (!databaseName) {
    throw new Error(
      "Could not determine database name from connection string.",
    );
  }
  return databaseName;
}
