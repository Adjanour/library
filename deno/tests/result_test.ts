import { assertEquals } from "@std/assert";
import {
  AlreadyExists,
  AppError,
  Err,
  fromTryCatch,
  NotFound,
  Ok,
  Validation,
} from "../src/result.ts";

Deno.test("Ok creates success result", () => {
  const r = Ok(42);
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.value, 42);
});

Deno.test("Err creates failure result", () => {
  const r = Err("boom");
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.error, "boom");
});

Deno.test("fromTryCatch catches exceptions", () => {
  const r = fromTryCatch(() => {
    throw new Error("bad");
  });
  assertEquals(r.ok, false);
  if (!r.ok) {
    assertEquals(r.error.code, "INTERNAL");
    assertEquals(r.error.message, "Error: bad");
  }
});

Deno.test("fromTryCatch returns value on success", () => {
  const r = fromTryCatch(() => 2 + 2);
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.value, 4);
});

Deno.test("NotFound error has correct shape", () => {
  const e = NotFound("Item", 5);
  assertEquals(e.code, "NOT_FOUND");
  assertEquals(e.message, "Item 5 not found");
});

Deno.test("AlreadyExists error has correct shape", () => {
  const e = AlreadyExists("Item", "path already exists");
  assertEquals(e.code, "ALREADY_EXISTS");
  assertEquals(e.message, "path already exists");
});

Deno.test("Validation error has correct shape", () => {
  const e = Validation("title", "cannot be empty");
  assertEquals(e.code, "VALIDATION");
  assertEquals(e.message, "title: cannot be empty");
});
