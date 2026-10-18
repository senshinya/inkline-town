import assert from "node:assert/strict"
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { IncomingMessage, ServerResponse } from "node:http"
import { Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { plugin } from "../src/server/replays.ts"

const replay = (savedAt: unknown) => ({
  format: "ritmo-replay", version: 1, library: "test", schema: "test", schedule: "simulate", reason: "test",
  savedAt, start: { tick: 0, snapshot: {} }, ticks: [], checkpoints: [], constants: {}
})

test("replay uploads reject invalid dates and origins without stopping the development server", () => {
  const root = mkdtempSync(join(tmpdir(), "inkline-replays-"))
  let upload: ((request: IncomingMessage, response: ServerResponse, next: () => void) => void) | undefined
  plugin().configureServer({
    config: { root, logger: { info: () => {} } },
    middlewares: { use: (_path, handler) => { upload = handler } }
  })
  const post = (data: unknown, origin = "http://localhost:5232") => {
    const request = new IncomingMessage(new Socket())
    request.method = "POST"
    request.headers = { host: "localhost:5232", origin }
    const response = new ServerResponse(request)
    assert(upload)
    upload(request, response, () => assert.fail("POST must be handled"))
    request.emit("data", JSON.stringify(data))
    assert.doesNotThrow(() => request.emit("end"), "a bad replay must not escape the HTTP callback")
    return response.statusCode
  }
  try {
    assert.equal(post(replay(undefined)), 400)
    assert.equal(post(replay(1e100)), 400)
    assert.equal(post(replay("2026-10-18")), 400)
    assert.equal(post(replay(Date.now()), "https://untrusted.example"), 403)
    assert.equal(post(replay(Date.now()), "https://localhost:5232"), 403)
    assert.equal(post(replay(Date.now())), 201)
    assert.equal(readdirSync(join(root, ".replays")).length, 1)
    // A file blocking the output directory reproduces a sink failure without changing permissions.
    rmSync(join(root, ".replays"), { recursive: true })
    writeFileSync(join(root, ".replays"), "blocked")
    assert.equal(post(replay(Date.now())), 500)
    rmSync(join(root, ".replays"))
    assert.equal(post(replay(Date.now())), 201, "a sink failure must not stop later uploads")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("replay uploads reject oversized declared and streamed bodies before parsing them", () => {
  const root = mkdtempSync(join(tmpdir(), "inkline-replay-size-"))
  let upload: ((request: IncomingMessage, response: ServerResponse, next: () => void) => void) | undefined
  plugin().configureServer({
    config: { root, logger: { info: () => {} } },
    middlewares: { use: (_path, handler) => { upload = handler } }
  })
  try {
    for (const declared of [true, false]) {
      const request = new IncomingMessage(new Socket())
      request.method = "POST"
      request.headers = { host: "localhost:5232", ...(declared ? { "content-length": String(32 * 1024 * 1024 + 1) } : {}) }
      const response = new ServerResponse(request)
      assert(upload)
      upload(request, response, () => assert.fail("POST must be handled"))
      if (!declared) {
        // Count UTF-8 bytes, rather than JavaScript string length, across chunks.
        request.emit("data", "汉".repeat(6 * 1024 * 1024))
        request.emit("data", "汉".repeat(6 * 1024 * 1024))
      }
      assert.equal(response.statusCode, 413, "reject as soon as the size is known")
      assert.doesNotThrow(() => {
        request.emit("data", "trailing data")
        request.emit("end")
      })
      assert.equal(response.statusCode, 413)
    }
    assert.deepEqual(readdirSync(root), [], "oversized bodies must not reach the file sink")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
