import type { MiddlewareHandlers } from "graphile-config";
import { Middleware, orderedApply, resolvePreset } from "graphile-config";

import type { CurrentMigrationLocation } from "./current";
import type { ParsedSettings, Settings } from "./settings";

/**
 * The extension points exposed by graphile-migrate plugins.
 *
 * Every activity takes an event object rather than positional arguments. This
 * deliberately leaves room to add context without breaking plugins.
 */
export interface GraphileMigrateMiddleware {
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

declare global {
  // graphile-config intentionally uses namespace declaration merging for its
  // extensible preset and plugin interfaces.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace GraphileConfig {
    interface Preset {
      /** Configuration options for graphile-migrate. */
      graphileMigrate?: Settings;
    }
    interface Plugin {
      graphileMigrate?: {
        middleware?: MiddlewareHandlers<GraphileMigrateMiddleware>;
      };
    }
  }
}

export function resolveGraphileMigratePreset(
  preset: GraphileConfig.Preset,
): GraphileConfig.ResolvedPreset {
  return resolvePreset(preset);
}

export function getGraphileMigrateMiddleware(
  resolvedPreset: GraphileConfig.ResolvedPreset,
): Middleware<GraphileMigrateMiddleware> {
  const middleware = new Middleware<GraphileMigrateMiddleware>();
  orderedApply(
    resolvedPreset.plugins,
    (plugin) => plugin.graphileMigrate?.middleware,
    (name, fn) => middleware.register(name, fn as never),
  );
  return middleware;
}
