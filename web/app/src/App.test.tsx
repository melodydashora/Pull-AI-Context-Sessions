import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";
import { App } from "./App.tsx";

it("shows the app name and the build that is running", () => {
  const html = renderToString(<App />);
  expect(html).toContain("SessionVault");
  expect(html).toContain("0.0.0-test");
  expect(html).toContain("build test");
});
