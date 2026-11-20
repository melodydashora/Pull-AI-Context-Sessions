import { type BuildInfo, describeBuild } from "@sessionvault/core";

// Both values are filled in when the app is built or served (see vite.config.ts).
declare const __APP_VERSION__: string;
declare const __BUILD_ID__: string;

/** What this copy of the app is. */
export const BUILD: BuildInfo = describeBuild(__APP_VERSION__, __BUILD_ID__);
