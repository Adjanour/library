import { assertEquals } from "@std/assert";
import {
  appCacheRoot,
  appDataRoot,
  defaultScanDirectories,
} from "../src/platform.ts";

Deno.test("platform data roots follow operating-system conventions", () => {
  assertEquals(
    appDataRoot("linux", { HOME: "/home/alex" }),
    "/home/alex/.local/share",
  );
  assertEquals(
    appDataRoot("darwin", { HOME: "/Users/alex" }),
    "/Users/alex/Library/Application Support",
  );
  assertEquals(
    appDataRoot("windows", {
      USERPROFILE: "C:\\Users\\alex",
      LOCALAPPDATA: "C:\\Users\\alex\\AppData\\Local",
    }),
    "C:\\Users\\alex\\AppData\\Local",
  );
  assertEquals(
    appCacheRoot("linux", { HOME: "/home/alex", XDG_CACHE_HOME: "/tmp/cache" }),
    "/tmp/cache",
  );
});

Deno.test("default scan folders are derived from the user home", () => {
  assertEquals(defaultScanDirectories({ HOME: "/home/alex" }), [
    "/home/alex/Documents",
    "/home/alex/Downloads",
    "/home/alex/Books",
  ]);
});
