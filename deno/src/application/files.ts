import type { DB } from "../db.ts";
import { openFile } from "../open.ts";

export class FilesService {
  constructor(private readonly db: DB) {}
  open(id: number) {
    return openFile(this.db, id);
  }
  item(id: number) {
    return this.db.getItem(id);
  }
}
