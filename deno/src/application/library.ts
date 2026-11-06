import type { DB } from "../db.ts";
import type { ItemUpdate, SearchQuery } from "../types.ts";

/** Catalog application operations. Persistence details stay behind this boundary. */
export class LibraryService {
  constructor(private readonly db: DB) {}
  search(query: SearchQuery) {
    return this.db.search(query);
  }
  stats() {
    return this.db.getStats();
  }
  categories() {
    return this.db.getCategories();
  }
  tags() {
    return this.db.getTags();
  }
  purposes() {
    return this.db.getPurposes();
  }
  item(id: number) {
    return this.db.getItem(id);
  }
  evidence(id: number) {
    return this.db.getMetadataEvidence(id);
  }
  suggestions(id: number) {
    return this.db.getMetadataSuggestions(id);
  }
  saveSuggestions(id: number, suggestions: Parameters<DB["saveMetadataSuggestions"]>[1]) {
    return this.db.saveMetadataSuggestions(id, suggestions);
  }
  resolveSuggestion(id: number, apply: boolean) {
    return this.db.resolveMetadataSuggestion(id, apply);
  }
  pendingSuggestions() {
    return this.db.getPendingMetadataSuggestions();
  }
  relatedCopies(id: number) {
    return this.db.getRelatedCopies(id);
  }
  contentSearch(query: string, limit?: number) {
    return this.db.searchDocumentContent(query, limit);
  }
  contentIndexState(id: number) {
    return this.db.getContentIndexState(id);
  }
  replaceDocumentContent(
    id: number,
    contentHash: string,
    status: Parameters<DB["replaceDocumentContent"]>[2],
    chunks: Parameters<DB["replaceDocumentContent"]>[3],
    error?: string,
  ) {
    return this.db.replaceDocumentContent(id, contentHash, status, chunks, error);
  }
  update(id: number, updates: ItemUpdate) {
    return this.db.updateItem(id, updates);
  }
  delete(id: number) {
    return this.db.deleteItem(id);
  }
  restore(id: number) {
    return this.db.restoreItem(id);
  }
  permanentlyDelete(id: number) {
    return this.db.permanentlyDeleteItem(id);
  }
  bulkUpdate(ids: number[], updates: ItemUpdate) {
    return this.db.bulkUpdateItems(ids, updates);
  }
  undo(batchId: string) {
    return this.db.undoEdits(batchId);
  }
  collections() {
    return this.db.collections;
  }
  createCollection(name: string, description?: string) {
    return this.db.createCollection(name, description);
  }
  updateCollection(id: number, name: string, description: string) {
    return this.db.updateCollection(id, name, description);
  }
  deleteCollection(id: number) {
    return this.db.deleteCollection(id);
  }
  collection(id: number) {
    return this.db.collection(id);
  }
  collectionItems(id: number) {
    return this.db.collectionItems(id);
  }
  addToCollection(collectionId: number, itemId: number) {
    return this.db.addItemToCollection(collectionId, itemId);
  }
  removeFromCollection(collectionId: number, itemId: number) {
    return this.db.removeItemFromCollection(collectionId, itemId);
  }
  reorderCollectionItems(collectionId: number, itemIds: number[]) {
    return this.db.reorderCollectionItems(collectionId, itemIds);
  }
}
