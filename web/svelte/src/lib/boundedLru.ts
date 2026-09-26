export class BoundedLru<K, V> {
    private readonly entries = new Map<K, V>();

    constructor(
        private readonly limit: number,
        private readonly onEvict: (key: K, value: V) => void,
    ) {
        if (!Number.isInteger(limit) || limit < 1) {
            throw new Error("LRU limit must be a positive integer");
        }
    }

    get size() {
        return this.entries.size;
    }

    get(key: K) {
        const value = this.entries.get(key);
        if (value === undefined) return undefined;
        this.entries.delete(key);
        this.entries.set(key, value);
        return value;
    }

    set(key: K, value: V) {
        const previous = this.entries.get(key);
        if (previous !== undefined) this.entries.delete(key);
        this.entries.set(key, value);
        if (previous !== undefined && previous !== value) this.onEvict(key, previous);

        while (this.entries.size > this.limit) {
            const oldest = this.entries.entries().next().value as [K, V] | undefined;
            if (!oldest) return;
            this.entries.delete(oldest[0]);
            this.onEvict(oldest[0], oldest[1]);
        }
    }

    delete(key: K) {
        const value = this.entries.get(key);
        if (value === undefined) return false;
        this.entries.delete(key);
        this.onEvict(key, value);
        return true;
    }

    clear() {
        for (const [key, value] of this.entries) this.onEvict(key, value);
        this.entries.clear();
    }
}
