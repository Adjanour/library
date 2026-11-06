import type { DB } from "../db.ts";
import type { ReadingProgressUpdate } from "../types.ts";

/** Application-facing reading commands. HTTP handlers should call these rather than DB methods. */
export class ReadingService {
  constructor(private readonly db: DB) {}
  start(itemId: number) {
    return this.db.startReadingSession(itemId);
  }
  heartbeat(itemId: number) {
    return { active: this.db.touchReadingSession(itemId) };
  }
  progress(itemId: number, input: ReadingProgressUpdate) {
    return this.db.recordReadingProgress(itemId, input);
  }
  finish(itemId: number) {
    return this.db.finishReading(itemId);
  }
  drop(itemId: number) {
    return this.db.dropReading(itemId);
  }
  closeActive() {
    return this.db.closeActiveSessions();
  }
}
