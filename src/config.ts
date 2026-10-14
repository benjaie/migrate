import type { MiddlewareHandlers } from "graphile-config";
import { Middleware, orderedApply, resolvePreset } from "graphile-config";

import type { CurrentMigrationLocation } from "./current";
import { MigratePreset } from "./preset";
import type { ParsedSettings, Settings } from "./settings";

/**
 * The extension points exposed by graphile-migrate plugins.
 *
 * Every activity takes an event object rather than positional arguments. This
 * deliberately leaves room to add context without breaking plugins.
 */
export interface GraphileMigrateMiddleware {
  reset(event: {
    parsedSettings: ParsedSettings;
    shadow: boolean;
  }): Promise<void>;
  allMigrations(event: {
    parsedSettings: ParsedSettings;
    shadow: boolean;
    forceActions: boolean;
  }): Promise<void>;
  currentMigration(event: {
    parsedSettings: ParsedSettings;
    shadow: boolean;
    forceActions: boolean;
  }): Promise<void>;
  readCurrentMigration(event: {
    parsedSettings: ParsedSettings;
    location: CurrentMigrationLocation;
  }): Promise<string>;
  compileIncludes(event: {
    parsedSettings: ParsedSettings;
    content: string;
    processedFiles: ReadonlySet<string>;
  }): Promise<string>;
}

type LegacyActionSettings = Pick<
  Settings,
  | "beforeReset"
  | "afterReset"
  | "beforeAllMigrations"
  | "afterAllMigrations"
  | "beforeCurrent"
  | "afterCurrent"
>;

const legacyActionKeys = [
  "beforeReset",
  "afterReset",
  "beforeAllMigrations",
  "afterAllMigrations",
  "beforeCurrent",
  "afterCurrent",
] as const satisfies ReadonlyArray<keyof LegacyActionSettings>;

declare global {
  // graphile-config intentionally uses namespace declaration merging for its
  // extensible preset and plugin interfaces.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace GraphileConfig {
    interface Preset {
      /** Configuration options for graphile-migrate. */
      migrate?: Settings;
    }
    interface Plugin {
      migrate?: {
        middleware?: MiddlewareHandlers<GraphileMigrateMiddleware>;
        /** @deprecated Compatibility adapter for a legacy .gmrc file. */
        legacyActions?: LegacyActionSettings;
      };
    }
  }
}

/** Converts a legacy .gmrc object into an equivalent Graphile Config preset. */
export function legacySettingsToPreset(
  settings: Settings,
): GraphileConfig.Preset {
  const migrate: Settings = { ...settings };
  const legacyActions: LegacyActionSettings = {};
  for (const key of legacyActionKeys) {
    const value = migrate[key];
    if (value !== undefined) {
      legacyActions[key] = value;
      delete migrate[key];
    }
  }

  const plugins: GraphileConfig.Plugin[] = [];
  if (Object.keys(legacyActions).length > 0) {
    plugins.push({
      name: "GraphileMigrateLegacyActionsPlugin",
      migrate: { legacyActions },
    });
  }

  return {
    extends: [MigratePreset],
    plugins,
    migrate,
  };
}

export function getLegacyActions(
  resolvedPreset: GraphileConfig.ResolvedPreset,
): LegacyActionSettings {
  const actions: LegacyActionSettings = {};
  for (const plugin of resolvedPreset.plugins) {
    const legacyActions = plugin.migrate?.legacyActions;
    if (legacyActions) Object.assign(actions, legacyActions);
  }
  return actions;
}

export function resolveGraphileMigratePreset(
  preset: GraphileConfig.Preset,
): GraphileConfig.ResolvedPreset {
  return resolvePreset({ extends: [MigratePreset, preset] });
}

export function getGraphileMigrateMiddleware(
  resolvedPreset: GraphileConfig.ResolvedPreset,
): Middleware<GraphileMigrateMiddleware> {
  const middleware = new Middleware<GraphileMigrateMiddleware>();
  orderedApply(
    resolvedPreset.plugins,
    (plugin) => plugin.migrate?.middleware,
    (name, fn) => middleware.register(name, fn as never),
  );
  return middleware;
}
