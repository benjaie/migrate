import type { MiddlewareHandlers } from "graphile-config";
import { Middleware, orderedApply, resolvePreset } from "graphile-config";

import { executeActions, makeValidateActionCallback } from "./actions";
import type { CurrentMigrationLocation } from "./current";
import { defaultLogger } from "./logger";
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
    const validate = makeValidateActionCallback(defaultLogger);
    const validateRoot = makeValidateActionCallback(defaultLogger, true);

    const beforeReset = validateRoot(legacyActions.beforeReset);
    const afterReset = validateRoot(legacyActions.afterReset);
    const beforeAllMigrations = validate(legacyActions.beforeAllMigrations);
    const afterAllMigrations = validate(legacyActions.afterAllMigrations);
    const beforeCurrent = validate(legacyActions.beforeCurrent);
    const afterCurrent = validate(legacyActions.afterCurrent);

    plugins.push({
      name: "GraphileMigrateLegacyActionsPlugin",
      migrate: {
        middleware: {
          async reset(next, event) {
            await executeActions(
              event.parsedSettings,
              event.shadow,
              beforeReset,
            );
            try {
              return await next();
            } finally {
              await executeActions(
                event.parsedSettings,
                event.shadow,
                afterReset,
              );
            }
          },
          async allMigrations(next, event) {
            await executeActions(
              event.parsedSettings,
              event.shadow,
              beforeAllMigrations,
            );
            try {
              return await next();
            } finally {
              await executeActions(
                event.parsedSettings,
                event.shadow,
                afterAllMigrations,
              );
            }
          },
          async currentMigration(next, event) {
            await executeActions(
              event.parsedSettings,
              event.shadow,
              beforeCurrent,
            );
            try {
              return await next();
            } finally {
              await executeActions(
                event.parsedSettings,
                event.shadow,
                afterCurrent,
              );
            }
          },
        },
      },
    });
  }

  return {
    extends: [MigratePreset],
    plugins,
    migrate,
  };
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
