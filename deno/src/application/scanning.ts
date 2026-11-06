import type { DB } from "../db.ts";
import { scanDirectory } from "../scanner.ts";

export class ScanningService {
  constructor(private readonly db: DB) {}
  scan(
    directories: string[],
    progress?: (current: number, total: number, filename: string) => void,
    force = false,
  ) {
    return scanDirectory(this.db, directories, progress, force);
  }
}
