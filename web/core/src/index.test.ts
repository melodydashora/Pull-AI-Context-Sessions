import { describe, expect, it } from "vitest";
import { APP_NAME, describeBuild, formatBuildLabel, INTERCHANGE_VERSION } from "./index.ts";

describe("build description", () => {
  it("names the product and keeps version and build", () => {
    const info = describeBuild("1.2.3", "abc1234");
    expect(info).toEqual({ name: "SessionVault", version: "1.2.3", build: "abc1234" });
    expect(formatBuildLabel(info)).toBe("SessionVault 1.2.3 (build abc1234)");
  });

  it("falls back when the version or the build is unknown", () => {
    expect(describeBuild("  ", "")).toEqual({ name: APP_NAME, version: "0.0.0", build: "dev" });
  });

  it("speaks version 1 of the interchange format", () => {
    expect(INTERCHANGE_VERSION).toBe(1);
  });
});
