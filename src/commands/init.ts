import * as fsp from "fs/promises";
import { CommandModule } from "yargs";

import { getCurrentMigrationLocation, writeCurrentMigration } from "../current";
import { parseSettings } from "../settings";
import { version } from "../version";
import { CommonArgv, exists, getSettings } from "./_common";

const DEFAULT_CONFIG_PATH = `${process.cwd()}/graphile.config.mts`;

interface InitArgv extends CommonArgv {
  folder?: boolean;
}

export async function init(options: InitArgv = {}): Promise<void> {
  if (await exists(DEFAULT_CONFIG_PATH)) {
    throw new Error(
      `graphile.config.mts file already exists at ${DEFAULT_CONFIG_PATH}`,
    );
  }
  if (options.config && (await exists(options.config))) {
    throw new Error(`Config file already exists at ${options.config}`);
  }

  const configPath = options.config || DEFAULT_CONFIG_PATH;
  const fileContent = `\
/*
 * Graphile Migrate configuration. Do not commit secrets; prefer DATABASE_URL,
 * SHADOW_DATABASE_URL and ROOT_DATABASE_URL. This is native TypeScript, so
 * only use syntax supported by Node.js type stripping.
 *
 * Generated with graphile-migrate v${version}.
 */
import { MigratePreset } from "graphile-migrate";
import type {} from "graphile-migrate";
import { execFile as rawExecFile } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(rawExecFile);

const MyMigrateLifecyclePlugin: GraphileConfig.Plugin = {
  name: "MyMigrateLifecyclePlugin",
  migrate: {
    middleware: {
      async reset(next, { shadow }) {
        try {
          return await next();
        } finally {
          // if (!shadow) await execFile("graphile-worker", ["--schema-only"]);
        }
      },
      async allMigrations(next, event) {
        try {
          return await next();
        } finally {
          // if (event.shadow && (event.hasChanges || event.forceActions)) {
          //   await execFile("./scripts/dump-db");
          // }
        }
      },
      async currentMigration(next, event) {
        try {
          return await next();
        } finally {
          // if (event.shadow && (event.hasChanges || event.forceActions)) {
          //   await execFile("./scripts/test-seed");
          // }
        }
      },
    },
  },
};

const preset: GraphileConfig.Preset = {
  extends: [MigratePreset],

  /*
   * Add plugins here to customize graphile-migrate. Plugins can wrap
   * readCurrentMigration or compileIncludes, for example to watch fixture
   * files and automatically include them in the current migration.
   */
  plugins: [
    MyMigrateLifecyclePlugin,
  ],

  migrate: {
    connectionString: process.env.DATABASE_URL,
    shadowConnectionString: process.env.SHADOW_DATABASE_URL,
    rootConnectionString: process.env.ROOT_DATABASE_URL,
    pgSettings: {
      // search_path: "app_public, app_private, public",
    },
    placeholders: {
      // ":DATABASE_VISITOR": process.env.DATABASE_VISITOR,
    },
    // blankMigrationContent: "-- Write your migration here\\n",
    // migrationsFolder: "./migrations",
    // manageGraphileMigrateSchema: false,
  },
};

export default preset;
`;
  await fsp.writeFile(configPath, fileContent);

  // eslint-disable-next-line no-console
  console.log(
    `Template Graphile Config preset written to '${configPath}'; please read and edit it to suit your needs.`,
  );
  const settings = await getSettings({ configFile: configPath });
  const parsedSettings = await parseSettings({
    extends: [settings],
    migrate: {
      connectionString: process.env.DATABASE_URL || "NOT_NEEDED",
      shadowConnectionString: process.env.SHADOW_DATABASE_URL || "NOT_NEEDED",
    },
  });
  await fsp.mkdir(parsedSettings.migrationsFolder);
  await fsp.mkdir(parsedSettings.migrationsFolder + "/committed");
  if (options.folder) {
    await fsp.mkdir(parsedSettings.migrationsFolder + "/current");
  }
  const currentLocation = await getCurrentMigrationLocation(parsedSettings);
  await writeCurrentMigration(
    parsedSettings,
    currentLocation,
    parsedSettings.blankMigrationContent.trim() + "\n",
  );
  // eslint-disable-next-line no-console
  console.log(
    `The current migration was created at '${currentLocation.path}'.\n${
      process.env.DATABASE_URL
        ? "Try"
        : "After configuring your connectionString/DATABASE_URL try"
    } running \`graphile-migrate watch\` and editing the current migration.`,
  );
}

export const initCommand: CommandModule<Record<string, never>, InitArgv> = {
  command: "init",
  aliases: [],
  describe: `\
Initializes a graphile-migrate project by creating a \`graphile.config.mts\` preset and \`migrations\` folder.`,
  builder: {
    folder: {
      type: "boolean",
      description: "Use a folder rather than a file for the current migration.",
      default: false,
    },
  },
  handler: init,
};
