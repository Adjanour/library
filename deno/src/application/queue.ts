import type { DB, QueueItemInput } from "../db.ts";

export class QueueService {
  constructor(private readonly db: DB) {}
  list() {
    return this.db.getReadingQueue();
  }
  add(item: QueueItemInput) {
    return this.db.addToReadingQueue(item);
  }
  remove(id: number) {
    return this.db.removeFromReadingQueue(id);
  }
  reorder(ids: number[]) {
    return this.db.reorderReadingQueue(ids);
  }
}
