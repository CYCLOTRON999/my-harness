import assert from "node:assert";
import { add, divide } from "./calculator.js";

assert.strictEqual(add(2, 3), 5, "add(2, 3) should equal 5");
assert.strictEqual(divide(10, 2), 5, "divide(10, 2) should equal 5");

assert.throws(
  () => divide(10, 0),
  /Division by zero is not allowed/,
  "divide(10, 0) should throw 'Division by zero is not allowed'"
);

console.log("All tests passed!");
