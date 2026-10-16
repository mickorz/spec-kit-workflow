import test from "node:test"
import assert from "node:assert/strict"
import { version } from "../src/index.js"

test("占位应用可导入", () => {
  assert.equal(typeof version, "string")
})
