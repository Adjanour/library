# Concepts Learned

## TypeScript vs Go

### Type narrowing with unions

TypeScript's union types need explicit narrowing. `result.ok === true` doesn't
automatically narrow `result.value` in the same scope. You need `if (result.ok)`
to tell TypeScript "trust me, this is the Ok branch."

```typescript
const r = deleteItem(1);
// r.value  ← TypeScript errors here, r could be Err
if (r.ok) {
  r.value  ← now TS knows this is the Ok branch
}
```

This is different from Go:

```go
result, err := db.DeleteItem(id)
// err check narrows automatically
if err != nil { ... }
```

In TypeScript, `if (result.ok)` IS the narrowing — like Go's `if err != nil` but
you check the success case instead.

### Nullable types: `T | null` vs `T | undefined`

- `null` = explicitly set to nothing (like Go's `*string` pointing to nil)
- `undefined` = not set / missing property
- For API params, use `T | null` to match JSON's `null`
- For optional object fields, use `T?` (which means `T | undefined`)

### `Record<string, number>` replaces Go's `map[string]int`

TypeScript's `Record<K, V>` is a utility type for objects with known key/value
types.

---

## Sync vs Async in Deno

### `node:sqlite` DatabaseSync is synchronous

`DatabaseSync` runs SQL on the main thread — no promises, no await. This is
intentional:

- SQLite operations are fast (microseconds for indexed queries)
- WAL mode handles concurrency at the database level
- No need to park a thread for I/O

```typescript
// This is synchronous — no await needed
const row = this.conn.prepare("SELECT * FROM items WHERE id = ?").get(id);
```

### When to use async

- `Deno.Command()` for running external tools (pdfinfo, sioyek)
- `Deno.readFile()` / `Deno.writeFile()` for large files
- HTTP fetches (`fetch()`)
- Anything that might block for user-facing response time

### `fromPromise` exists for when you need it

```typescript
// Use fromTryCatch for sync operations (SQLite)
const result = fromTryCatch(() => db.getItem(id));

// Use fromPromise for async operations (file I/O, HTTP)
const result = await fromPromise(() => Deno.readFile(path));
```

---

## Error Handling Patterns

### Domain errors vs Infrastructure errors

The `AppError` type models both:

```typescript
type ErrorCode =
  | "NOT_FOUND" // Domain: entity doesn't exist
  | "ALREADY_EXISTS" // Domain: duplicate constraint
  | "VALIDATION" // Domain: bad input
  | "DATABASE" // Infrastructure: SQL failure
  | "IO" // Infrastructure: file system
  | "INTERNAL"; // Infrastructure: unexpected
```

**Domain errors** are expected business logic:

```typescript
const item = db.getItem(id);
if (!item) return Err(NotFound("Item", id));
```

**Infrastructure errors** come from system failures:

```typescript
return fromTryCatch(() => {
  this.conn.prepare(query).run(...args);
  // If SQLite throws, fromTryCatch wraps it as AppError("DATABASE", ...)
});
```

### Why this matters for APIs

```typescript
app.get("/api/items/:id", (c) => {
  const result = db.getItem(id);
  if (!result) {
    // Domain error → 404
    return c.json({ error: "Item not found" }, 404);
  }
  // Infrastructure error → 500
  return c.json(result);
});
```

---

## Result Pattern — Functional Error Handling

### The problem

Try/catch is control flow noise. It mixes infrastructure concerns with business
logic:

```typescript
// Bad: try/catch scattered everywhere
try {
  const row = db.prepare("SELECT ...").get(id);
  if (!row) return Err(NotFound(...));
  return Ok(row);
} catch (e) {
  return Err(DatabaseError(...));
}
```

### The solution: combinators

Instead of manual try/catch, use small functions that compose:

```typescript
// Good: data in, Result out
const row = db.prepare("SELECT ...").get(id);
return fromNullable(row, NotFound("Item", id));
```

### Combinators

| Function                     | Input → Output                              |
| ---------------------------- | ------------------------------------------- |
| `fromNullable(value, error)` | `null \| undefined` → `Err`, defined → `Ok` |
| `fromTryCatch(fn)`           | exception → `Err`, return → `Ok`            |
| `map(result, fn)`            | transform value inside `Ok`                 |
| `flatMap(result, fn)`        | chain operations that return `Result`       |
| `match(result, { ok, err })` | exhaustive pattern match                    |
| `unwrapOr(result, default)`  | get value or fallback                       |

### Chaining with map/flatMap

```typescript
// map: transform the value
const name = map(db.getItem(1), (item) => item.title);

// flatMap: chain operations that can fail
const path = flatMap(db.getItem(1), (item) => {
  return fromNullable(item.path, Validation("path", "empty"));
});
```

### Pattern matching

```typescript
const result = db.getItem(id);
match(result, {
  ok: (item) => c.json(item), // 200
  err: (e) =>
    e.code === "NOT_FOUND"
      ? c.json({ error: e.message }, 404) // 404
      : c.json({ error: e.message }, 500), // 500
});
```

### When to use which constructor

| Scenario                        | Use                                  |
| ------------------------------- | ------------------------------------ |
| Query returns nullable          | `fromNullable(value, NotFound(...))` |
| Code might throw                | `fromTryCatch(() => ...)`            |
| External process (Deno.Command) | `fromPromise(() => ...)`             |
| Already have Ok/Err             | Just return them                     |

---

## `node:sqlite` API

### Statement types

- `prepare(sql).get(...params)` → single row or undefined
- `prepare(sql).all(...params)` → array of rows
- `prepare(sql).run(...params)` → `{ changes: number, lastInsertRowid: number }`

### SQL parameter binding

`node:sqlite` uses positional `?` placeholders (same as Go's `database/sql`):

```typescript
this.conn.prepare("SELECT * FROM items WHERE type = ? AND year > ?").get(
  "book",
  2020,
);
```

### Spread operator with run()

```typescript
const args = ["book", 2020];
this.conn.prepare("SELECT * FROM items WHERE type = ? AND year > ?").run(
  ...args,
);
//                   ↑ spread operator unpacks array as arguments
```

---

## Type Assertions — `as` and double casting

### How `as` works

TypeScript's `as` is a **type assertion**, not a type cast. It tells the
compiler "treat this as that" — it does **nothing at runtime**.

The rule: `A as B` is allowed if **A and B are related** (either can be assigned
to the other).

```typescript
// OK — Animal and Cat are related (Cat extends Animal)
animal as Cat;

// FAIL — string and number are unrelated
"hello" as number;
// Error: Conversion of type 'string' to type 'number'
// may be a mistake because neither type sufficiently overlaps
```

### The type hierarchy

```
never  ← bottom type, assignable to everything
  ↑
unknown  ← top type, everything assignable to it
  ↑
any  ← escape hatch, bypasses all type checking
```

| From → To | unknown | any | never |
|-----------|---------|-----|-------|
| anything → | ✓ | ✓ | ✓ |

### Why `as unknown as X` works

Since everything is assignable to `unknown`, and `unknown` is assignable to
everything (with explicit cast):

1. `rows as unknown` — always works (anything → unknown)
2. `unknown as Item[]` — always works (unknown → anything)

Together: `rows as unknown as Item[]` bypasses the "related types" check.

### When it's needed

`node:sqlite`'s `.all()` returns something like `object[]`. TypeScript rejects
`object[] as Item[]` because `object` and `Item` aren't structurally related
enough:

```typescript
const rows = this.conn.prepare("...").all();  // returns object[]

// FAILS — object and Item aren't related
rows as Item[];

// WORKS — double cast through unknown
rows as unknown as Item[];
```

### The danger

```typescript
const num = "hello" as unknown as number;
// TypeScript thinks num is a number
// But it's still a string at runtime
// num.toFixed(2) would crash
```

This is a way to lie to the compiler. For SQL query results where you control
the query, it's safe. But the compiler can't verify that.

### Alternatives

```typescript
// 1. Type the prepare call directly (most explicit)
const rows = this.conn
  .prepare("SELECT id, title FROM items")
  .all() as { id: number; title: string }[];

// 2. Use a type guard function (runtime safe)
function isItem(row: unknown): row is Item {
  return typeof row === "object" && row !== null && "id" in row;
}
const rows = this.conn.prepare("...").all().filter(isItem);

// 3. Double cast (concise, safe for controlled queries)
const rows = this.conn.prepare("...").all() as unknown as Item[];
```

### Rule of thumb

- For SQL results you control: double cast is fine
- For external API responses: use type guards or zod validation
- For internal refactoring: prefer type guards over assertions

---

## Key Differences from Go

| Concept          | Go                 | TypeScript                    |
| ---------------- | ------------------ | ----------------------------- |
| Error handling   | `if err != nil`    | `if (result.ok)` or try/catch |
| Null safety      | `*string` pointer  | `string \| null`              |
| Map type         | `map[string]int`   | `Record<string, number>`      |
| String building  | `fmt.Sprintf`      | template literals `` ` ``     |
| Import           | `import "package"` | `import { x } from "module"`  |
| Schema migration | Manual SQL in code | Same (no migration tool)      |
| SQLite API       | `database/sql`     | `node:sqlite` DatabaseSync    |
