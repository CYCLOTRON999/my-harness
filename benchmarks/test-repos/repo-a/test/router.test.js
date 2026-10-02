import test from "node:test";
import assert from "node:assert";
import { Router } from "../src/router.js";

test("Router - basic static route matching", () => {
  const router = new Router();
  router.get("/users", () => "users_list");

  const match = router.match("GET", "/users");
  assert.notStrictEqual(match, null);
  assert.strictEqual(match.handler(), "users_list");
});

test("Router - parameter extraction", () => {
  const router = new Router();
  router.get("/users/:id", (req) => req.params.id);

  const match = router.match("GET", "/users/42");
  assert.notStrictEqual(match, null);
  assert.strictEqual(match.params.id, "42");
});
