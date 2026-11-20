import { APP_NAME, formatBuildLabel } from "@sessionvault/core";
import { BUILD } from "./build.ts";

/** The start page. For now it only says what this is and which build is running. */
export function App() {
  return (
    <main>
      <h1>{APP_NAME}</h1>
      <p>Keep your AI chat sessions in one private vault, and carry their context into a new conversation.</p>
      <p className="build">{formatBuildLabel(BUILD)}</p>
    </main>
  );
}
