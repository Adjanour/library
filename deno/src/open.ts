import { extname } from "@std/path";
import type { Result } from "./result.ts";
import { AppError, Err, Ok } from "./result.ts";
import type { DB } from "./db.ts";

export function openFile(
  db: DB,
  id: number,
): Result<{ status: string }, AppError<"NOT_FOUND" | "IO" | "DATABASE">> {
  const item = db.getItem(id);
  if (!item.ok) return Err(item.error);

  const ext = extname(item.value.path).toLowerCase();
  const path = item.value.path;

  const commands: Array<[string, string[]]> = [];
  if (Deno.build.os === "linux") {
    if (ext === ".pdf") commands.push(["sioyek", [path]]);
    if ([".epub", ".mobi", ".azw3", ".fb2"].includes(ext)) {
      commands.push(["readest", [path]]);
      commands.push(["flatpak", [
        "run",
        "--file-forwarding",
        "com.bilingify.readest",
        "@@",
        path,
        "@@",
      ]]);
    }
    commands.push(["xdg-open", [path]]);
  } else if (Deno.build.os === "darwin") {
    commands.push(["open", [path]]);
  } else if (Deno.build.os === "windows") {
    commands.push(["cmd", ["/d", "/c", "start", "", path]]);
  }

  let lastError: unknown = "no launcher available";
  for (const [program, args] of commands) {
    try {
      new Deno.Command(program, { args }).spawn();
      return Ok({ status: "opened" });
    } catch (error) {
      lastError = error;
    }
  }
  return Err(AppError("IO", `failed to open: ${lastError}`, lastError));
}
