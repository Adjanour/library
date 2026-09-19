import { extname } from "@std/path";
import type { Result } from "./result.ts";
import { Ok, Err, AppError } from "./result.ts";
import type { DB } from "./db.ts";

export function openFile(db: DB, id: number): Result<{ status: string },AppError<"NOT_FOUND"|"IO"|"DATABASE">> {
  const item = db.getItem(id);
  if (!item.ok) return Err(item.error);

  const ext = extname(item.value.path).toLowerCase();
  const path = item.value.path;

  let cmd: Deno.Command;

  if (ext === ".pdf") {
    cmd = new Deno.Command("sioyek", { args: [path] });
  } else if ([".epub", ".mobi", ".azw3", ".fb2"].includes(ext)) {
    cmd = new Deno.Command("readest", { args: [path] });
  } else if (Deno.build.os === "linux") {
    cmd = new Deno.Command("xdg-open", { args: [path] });
  } else if (Deno.build.os === "darwin") {
    cmd = new Deno.Command("open", { args: [path] });
  } else {
    return Err(AppError("IO", "unsupported platform"));
  }

  try {
    cmd.spawn();
    return Ok({ status: "opened" });
  } catch (e) {
    if (Deno.build.os === "linux" && [".epub", ".mobi", ".azw3", ".fb2"].includes(ext)) {
      try {
        new Deno.Command("flatpak", {
          args: ["run", "--file-forwarding", "com.bilingify.readest", "@@", path, "@@"],
        }).spawn();
        return Ok({ status: "opened" });
      } catch {
        // Return the original error below when neither launcher works.
      }
    }
    return Err(AppError("IO", `failed to open: ${e}`, e));
  }
}
