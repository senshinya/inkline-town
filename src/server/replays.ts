/** Development replay uploads, with validation before the file sink and contained callback failures. */
import { Replay } from "@typeonce/ritmo-devtools"
import * as ReplayNodeSink from "@typeonce/ritmo-devtools/ReplayNodeSink"
import type { Plugin } from "@typeonce/ritmo-devtools/ReplayVitePlugin"
import { endpoint } from "@typeonce/ritmo-devtools/ReplayViteSink"

const BODY_LIMIT = 32 * 1024 * 1024

export const plugin = (): Plugin => ({
  name: "inkline-town:replays",
  apply: "serve",
  configureServer: (server) => {
    const sink = ReplayNodeSink.make({ directory: `${server.config.root}/.replays` })
    server.middlewares.use(endpoint, (request, response, next) => {
      if (request.method !== "POST") return next()
      const reply = (status: number, text: string) => {
        if (response.writableEnded) return
        response.statusCode = status
        response.end(text)
      }
      request.on("error", () => reply(400, "Could not read the replay"))
      const protocol = "encrypted" in request.socket && request.socket.encrypted ? "https" : "http"
      if (request.headers.origin !== undefined && request.headers.origin !== `${protocol}://${request.headers.host}`) {
        reply(403, "Replay uploads must come from this development server")
        return
      }
      if (Number(request.headers["content-length"]) > BODY_LIMIT) {
        reply(413, "The replay is too large")
        request.resume()
        return
      }
      let body = ""
      let bytes = 0
      request.setEncoding("utf8")
      request.on("data", (chunk: string) => {
        if (response.writableEnded) return
        bytes += Buffer.byteLength(chunk, "utf8")
        if (bytes > BODY_LIMIT) {
          body = ""
          reply(413, "The replay is too large")
          return
        }
        body += chunk
      })
      request.on("end", () => {
        if (response.writableEnded) return
        let data: unknown
        try { data = JSON.parse(body) } catch {
          reply(400, "Expected a JSON replay")
          return
        }
        // Replay.parse checks replay structure but not the timestamp used to name its file.
        if (typeof data !== "object" || data === null || !("savedAt" in data)
          || typeof data.savedAt !== "number" || !Number.isFinite(new Date(data.savedAt).getTime())) {
          reply(400, "The replay must have a valid save time")
          return
        }
        try {
          const parsed = Replay.parse(data)
          if (!parsed.ok) {
            reply(400, parsed.error._tag === "InvalidReplay" ? parsed.error.message : parsed.error._tag)
            return
          }
          sink.save(parsed.value)
          const path = sink.written.at(-1)!.slice(server.config.root.length + 1)
          server.config.logger.info(`[ritmo] replay saved: ${path} (${parsed.value.ticks.length} ticks): ${parsed.value.reason}`)
          reply(201, path)
        } catch {
          reply(500, "Could not save the replay")
        }
      })
    })
  }
})
