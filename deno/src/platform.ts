import { join } from "@std/path";

type Environment = Record<string, string | undefined>;

export function userHome(env: Environment = Deno.env.toObject()): string {
  return env.HOME ?? env.USERPROFILE ?? ".";
}

export function appDataRoot(
  os: typeof Deno.build.os = Deno.build.os,
  env: Environment = Deno.env.toObject(),
): string {
  const home = userHome(env);
  if (os === "windows") {
    return env.LOCALAPPDATA ?? join(home, "AppData", "Local");
  }
  if (os === "darwin") return join(home, "Library", "Application Support");
  return env.XDG_DATA_HOME ?? join(home, ".local", "share");
}

export function appCacheRoot(
  os: typeof Deno.build.os = Deno.build.os,
  env: Environment = Deno.env.toObject(),
): string {
  const home = userHome(env);
  if (os === "windows") {
    return env.LOCALAPPDATA ?? join(home, "AppData", "Local");
  }
  if (os === "darwin") return join(home, "Library", "Caches");
  return env.XDG_CACHE_HOME ?? join(home, ".cache");
}

export function defaultScanDirectories(
  env: Environment = Deno.env.toObject(),
): string[] {
  const home = userHome(env);
  return [
    join(home, "Documents"),
    join(home, "Downloads"),
    join(home, "Books"),
  ];
}
