import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { BoundedLru } from "../../web/svelte/src/lib/boundedLru.ts";

Deno.test("bounded LRU evicts the least recently used value", () => {
  const evicted: number[] = [];
  const cache = new BoundedLru<number, string>(2, (key) => evicted.push(key));

  cache.set(1, "one");
  cache.set(2, "two");
  assertEquals(cache.get(1), "one");
  cache.set(3, "three");

  assertEquals(cache.get(1), "one");
  assertEquals(cache.get(2), undefined);
  assertEquals(cache.get(3), "three");
  assertEquals(evicted, [2]);
});

Deno.test("replacing a cached value disposes the previous value", () => {
  const evicted: Array<[number, string]> = [];
  const cache = new BoundedLru<number, string>(2, (key, value) => evicted.push([key, value]));

  cache.set(1, "old");
  cache.set(1, "new");

  assertEquals(cache.get(1), "new");
  assertEquals(evicted, [[1, "old"]]);
});

Deno.test("LRU delete and clear dispose retained values", () => {
  const evicted: number[] = [];
  const cache = new BoundedLru<number, number>(3, (key) => evicted.push(key));

  cache.set(1, 1);
  cache.set(2, 2);
  assert(cache.delete(1));
  cache.clear();

  assertEquals(evicted, [1, 2]);
  assertEquals(cache.size, 0);
});

Deno.test("LRU rejects an invalid limit", () => {
  assertThrows(() => new BoundedLru(0, () => {}));
  assertThrows(() => new BoundedLru(1.5, () => {}));
});
