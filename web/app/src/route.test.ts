import { expect, it } from "vitest";
import { parseLocation, pathOf } from "./route.ts";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

it("reads the three addresses of the app", () => {
  expect(parseLocation("/sessions", null)).toEqual({ screen: { name: "list" }, importOpen: false });
  expect(parseLocation(`/sessions/${ID}`, null)).toEqual({
    screen: { name: "detail", id: ID },
    importOpen: false,
  });
  expect(parseLocation("/import", null)).toEqual({ screen: { name: "list" }, importOpen: true });
  expect(parseLocation("/import", { under: `/sessions/${ID}` })).toEqual({
    screen: { name: "detail", id: ID },
    importOpen: true,
  });
});

it("takes anything else for the list", () => {
  for (const path of [
    "/",
    "",
    "/sessions/",
    "/sessions/not-an-id",
    `/sessions/${ID.toUpperCase()}`,
    `/sessions/${ID}/extra`,
    "/settings",
    "/sessions/../x",
  ]) {
    expect(parseLocation(path, null).screen).toEqual({ name: "list" });
  }
  expect(parseLocation("/import", { under: "javascript:alert(1)" })).toEqual({
    screen: { name: "list" },
    importOpen: true,
  });
  expect(parseLocation("/import", "text")).toEqual({ screen: { name: "list" }, importOpen: true });
});

it("writes an address that it reads back", () => {
  expect(pathOf({ name: "list" })).toBe("/sessions");
  expect(parseLocation(pathOf({ name: "detail", id: ID }), null).screen).toEqual({ name: "detail", id: ID });
});
