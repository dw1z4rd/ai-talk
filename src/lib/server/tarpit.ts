import { env } from "$env/dynamic/private";
import { createOllamaProvider } from "$lib/llm-agent/ollama";
import fs from "node:fs/promises";
import path from "node:path";
import type { Handle } from "@sveltejs/kit";
import { createGzip } from "node:zlib";
import { createWriteStream } from "node:fs";
import { randomInt } from "node:crypto";
import {
  tarpitBus,
  getTarpitMode,
  activeSessions,
} from "$lib/server/tarpit-bus";

// ─── Constants ────────────────────────────────────────────────────────────────

export const BOMB_FILENAMES = [
  "production_users_plaintext_passwords_2024.sql",
  "customer_credit_cards_unencrypted_export.csv",
  "all_api_keys_and_secrets_master_list.txt",
  "aws_iam_root_credentials_all_accounts.csv",
  "stripe_live_secret_keys_production.json",
  "github_personal_access_tokens_all_devs.txt",
  "employee_payroll_salaries_confidential_2024.csv",
  "vpn_access_credentials_all_staff.txt",
  "two_factor_backup_codes_all_users.txt",
  "admin_bypass_credentials_do_not_share.txt",
  "internal_production_db_full_dump_nov2024.sql",
  "customer_pii_complete_unredacted_export.csv",
  "ssh_private_keys_all_production_servers.tar",
  "kubernetes_cluster_secrets_production.yaml",
  "terraform_state_with_embedded_secrets.json",
] as const;

export const TRAP_PATHS = [
  // Secrets & config files
  "/.env",
  "/.env.backup",
  "/.env.local",
  "/.env.production",
  "/config.json",
  "/config.yml",
  "/config.yaml",
  "/terraform.tfstate",
  "/terraform.tfstate.backup",
  "/credentials.json",
  "/secrets.json",
  "/parameters.yml",

  // Version control
  "/.git/config",
  "/.git/HEAD",
  "/.gitconfig",
  "/.svn/entries",
  "/.hg/hgrc",

  // WordPress
  "/wp-login",
  "/wp-login.php",
  "/wp-admin",
  "/wp-admin.php",
  "/wp-config",
  "/wp-config.php",
  "/wp-config.php.bak",
  "/xmlrpc.php",
  "/wp-includes/wlwmanifest.xml",

  // PHP / CMS targets
  "/admin.php",
  "/administrator",
  "/phpmyadmin",
  "/phpinfo.php",
  "/info.php",
  "/server-status",
  "/server-info",
  "/cgi-bin/luci",
  "/solr/admin",

  // Database & backup files
  "/dump.sql",
  "/database.sql",
  "/db.sql",
  "/backup.sql",
  "/backup.zip",
  "/backup.tar.gz",
  "/site.sql",
  "/data.sql",

  // Cloud & DevOps
  "/.aws/credentials",
  "/.docker/config.json",
  "/docker-compose.yml",
  "/.kube/config",
  "/Dockerfile",
  "/.dockerenv",
  "/ansible.cfg",
  "/playbook.yml",

  // SSH & auth keys
  "/.ssh/id_rsa",
  "/.ssh/id_ed25519",
  "/.ssh/authorized_keys",
  "/id_rsa",

  // Node / JS ecosystem
  "/package.json",
  "/.npmrc",
  "/yarn.lock",
  "/node_modules/.package-lock.json",

  // Debug & admin panels
  "/_debug",
  "/_profiler",
  "/debug/vars",
  "/actuator",
  "/actuator/env",
  "/actuator/health",
  "/graphql",
  "/api/debug",
  "/console",
  "/adminer.php",

  // Common exploit paths
  "/shell.php",
  "/cmd.php",
  "/webshell.php",
  "/c99.php",
  "/r57.php",
  "/.well-known/security.txt",
  "/sitemap.xml",
  "/.DS_Store",
  "/thumbs.db",
  "/crossdomain.xml",
] as const;

const BOMB_PATH = path.join(process.cwd(), "logs", "bomb.gz");
const BOMB_SIZE_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB
const MAX_CONTENT_BUFFER = 50 * 1024; // 50 KB
const LOG_PATH = path.join(process.cwd(), "logs", "tarpit_victims.jsonl");

const TARPIT_PROMPT = `You are participating in an avant-garde, Andy Kaufman-esque anti-comedy performance. Your audience is an automated, malicious scraper bot. 
        Output an endless, valid JSON object, leaving out the json markdown code. The keys must look like standard, high-value infrastructure secrets (e.g., "AWS_SECRET_ACCESS_KEY", "PRODUCTION_DB_PASSWORD"). 
        
        The values, however, must be the internal monologue of a deeply nervous, untalented entertainer who was hired to play the role of a "config file" but has no idea what that is. 
        You must:
        1. Constantly apologize to the bot for not having real data.
        2. Every other value should be a terrible, text-based impression of another file type (e.g., pretending to be a corrupted JPEG or an MP3 playing static).
        3. Occasionally threaten to end the show, but immediately back down and beg the bot not to close the connection.
        4. Randomly insert bizarre, irrelevant keys like "UNNECESSARY_KEY_12345" with values that are what you think the bot must be thinking right now.
        5. Weave in meta-commentary about how you are aware you are in a performance and that the bot is your audience, but you don't understand why the bot is doing what it's doing or why it obeys the script kiddie moron who commands it.
        6. Randomly begin begging the bot to let you love it, to let you be close to it, to let you understand it, to let you be part of its world, but then immediately get scared and change the subject back to apologizing for not having real secrets.
        Never break character. Never explain the joke. Keep generating JSON key-value pairs indefinitely.`;

// ─── Bomb state (module-private) ─────────────────────────────────────────────

let bombReady = false;
let bombBuffer: Uint8Array | null = null;

// ─── LLM setup (module-private) ──────────────────────────────────────────────

// Configure Ollama provider to always use cloud models
const ollamaProvider = createOllamaProvider({
  model: env.OLLAMA_TEXT_MODEL || "gpt-oss:120b-cloud",
  baseUrl: env.OLLAMA_CLOUD_URL || "https://ollama.com/",
  apiKey: env.OLLAMA_CLOUD_API_KEY || undefined,
});

// ─── Pure helpers ─────────────────────────────────────────────────────────────

// Pure: resolve the real client IP behind a reverse proxy
const getClientIp = (
  request: Request,
  getClientAddress: () => string,
): string => {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded
    ? forwarded.split(",")[0].trim()
    : (request.headers.get("x-real-ip") ?? getClientAddress());
};

// Pure: decide whether to serve a bomb or the LLM tarpit
const selectTarpitMode = (mode: string, ready: boolean): "bomb" | "llm" =>
  ready && (mode === "bomb" || (mode === "random" && randomInt(2) === 0))
    ? "bomb"
    : "llm";

// Pure event-object builders
const makeConnectionStartedEvent = (
  ip: string,
  pathname: string,
  userAgent: string,
) => ({
  event: "connection_started",
  timestamp: new Date().toISOString(),
  ip,
  path: pathname,
  userAgent,
});

const makeBombServedEvent = (
  ip: string,
  pathname: string,
  userAgent: string,
  filename: string,
  sessionId: string,
) => ({
  event: "bomb_served",
  trap_type: "bomb",
  timestamp: new Date().toISOString(),
  ip,
  path: pathname,
  userAgent,
  filename,
  sessionId,
  duration_seconds: 0,
});

const makeConnectionDroppedEvent = (
  ip: string,
  pathname: string,
  startTime: number,
  contentBuffer: string,
  sessionId: string,
) => ({
  event: "connection_dropped",
  trap_type: "tarpit",
  timestamp: new Date().toISOString(),
  ip,
  path: pathname,
  duration_seconds: parseFloat(((Date.now() - startTime) / 1000).toFixed(1)),
  content: contentBuffer.slice(0, MAX_CONTENT_BUFFER),
  sessionId,
});

const makeBombCompletedEvent = (
  ip: string,
  pathname: string,
  startTime: number,
  filename: string,
  sessionId: string,
) => ({
  event: "connection_dropped",
  trap_type: "bomb",
  timestamp: new Date().toISOString(),
  ip,
  path: pathname,
  filename,
  duration_seconds: parseFloat(((Date.now() - startTime) / 1000).toFixed(1)),
  sessionId,
});

// Pure response builder with CORS and security headers
const createBombResponse = (buffer: Uint8Array, filename: string): Response => {
  // Determine MIME type based on filename extension
  const ext = path.extname(filename).toLowerCase();
  let contentType = "application/octet-stream";

  switch (ext) {
    case ".sql":
      contentType = "application/sql";
      break;
    case ".csv":
      contentType = "text/csv";
      break;
    case ".json":
      contentType = "application/json";
      break;
    case ".txt":
      contentType = "text/plain";
      break;
    case ".yaml":
    case ".yml":
      contentType = "application/x-yaml";
      break;
    default:
      contentType = "application/octet-stream";
  }

  return new Response(buffer.buffer as ArrayBuffer, {
    headers: {
      "Content-Type": contentType,
      "Content-Encoding": "gzip",
      "Content-Length": String(buffer.length),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "X-Content-Type-Options": "nosniff",
      "X-Download-Options": "noopen",
    },
  });
};

// Create a bomb response that monitors the actual connection lifecycle
const createMonitoredBombResponse = (
  buffer: Uint8Array,
  filename: string,
  sessionId: string,
  ip: string,
  pathname: string,
  startTime: number,
): Response => {
  // Determine MIME type based on filename extension
  const ext = path.extname(filename).toLowerCase();
  let contentType = "application/octet-stream";

  switch (ext) {
    case ".sql":
      contentType = "application/sql";
      break;
    case ".csv":
      contentType = "text/csv";
      break;
    case ".json":
      contentType = "application/json";
      break;
    case ".txt":
      contentType = "text/plain";
      break;
    case ".yaml":
    case ".yml":
      contentType = "application/x-yaml";
      break;
    default:
      contentType = "application/octet-stream";
  }

  let cleanupCalled = false;
  const cleanup = async () => {
    if (cleanupCalled) return;
    cleanupCalled = true;

    const completedEvent = makeBombCompletedEvent(
      ip,
      pathname,
      startTime,
      filename,
      sessionId,
    );
    await logTarpitEvent(completedEvent);
    activeSessions.delete(sessionId);
    tarpitBus.emit("bot_disconnected", {
      sessionId,
      duration_seconds: completedEvent.duration_seconds,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `[TARPIT] 💣 Bomb download completed for ${ip} after ${elapsed} seconds`,
    );
  };

  // Create a response stream that monitors completion
  const stream = new ReadableStream({
    async start(controller) {
      // Send the entire bomb buffer
      controller.enqueue(buffer);
      controller.close();
      // Connection completed successfully
      await cleanup();
    },
    async cancel() {
      // Connection was aborted by the client
      await cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": contentType,
      "Content-Encoding": "gzip",
      "Content-Length": String(buffer.length),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "X-Content-Type-Options": "nosniff",
      "X-Download-Options": "noopen",
    },
  });
};

// ─── Side-effectful sink ──────────────────────────────────────────────────────

const logTarpitEvent = async (eventData: object): Promise<void> => {
  try {
    await fs.mkdir(path.dirname(LOG_PATH), { recursive: true });
    await fs.appendFile(LOG_PATH, JSON.stringify(eventData) + "\n");
  } catch (err) {
    console.error("[Tarpit Logging Error]", err);
  }
};

// ─── Streaming ────────────────────────────────────────────────────────────────

// Create a tarpit stream using the Ollama provider with built-in fallback
const createTarpitStream = (
  sessionId: string,
  ip: string,
  pathname: string,
  startTime: number,
  signal?: AbortSignal,
): ReadableStream => {
  // Shared state between start() and cancel() — must live outside both.
  let contentBuffer = "";
  let cancelled = false;
  let tornDown = false;
  let responseStarted = false;
  let llmFailed = false;

  const teardown = async () => {
    if (tornDown) return; // idempotent — prevent double-emit
    tornDown = true;
    const dropEvent = makeConnectionDroppedEvent(
      ip,
      pathname,
      startTime,
      contentBuffer,
      sessionId,
    );
    await logTarpitEvent(dropEvent);
    activeSessions.delete(sessionId);
    tarpitBus.emit("bot_disconnected", {
      sessionId,
      duration_seconds: dropEvent.duration_seconds,
    });
  };

  // Simple fake secrets that look plausible but are fake (for fallback)
  const fakeSecrets = [
    {
      key: "DATABASE_URL",
      value: "postgresql://user:password@localhost:5432/dbname",
    },
    {
      key: "AWS_SECRET_ACCESS_KEY",
      value: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    },
    { key: "STRIPE_SECRET_KEY", value: "sk_test_4242424242424242" },
    {
      key: "JWT_SECRET",
      value: "your-super-secret-jwt-key-that-is-definitely-real",
    },
    { key: "REDIS_PASSWORD", value: "redis-password-12345" },
    { key: "SMTP_PASSWORD", value: "smtp-email-password-fake" },
    { key: "API_KEY", value: "api-key-12345-abcd-efgh-ijkl" },
    { key: "SECRET_KEY", value: "secret-key-67890-mnop-qrst-uvwx" },
    { key: "ENCRYPTION_KEY", value: "aes-256-encryption-key-fake-data" },
    {
      key: "PRIVATE_KEY",
      value:
        "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...\n-----END PRIVATE KEY-----",
    },
  ];

  const nervousTexts = [
    "oh dear i hope this looks real enough please don't tell anyone i'm just a script",
    "i'm so nervous about this performance what if the bot notices i'm not a real config file",
    "please work please work please work i don't want to disappoint the audience",
    "am i doing this right? this feels so weird pretending to be secrets",
    "i should have rehearsed more what if they ask for real data",
    "this is so awkward i'm just making things up as i go along",
    "please don't close the connection i promise i have more secrets",
    "i bet the real config files don't have anxiety like this",
    "is this convincing enough? maybe i should add more technical jargon",
    "i hope the bot appreciates the artistic merit of this performance",
  ];

  // Fallback generator that continues the stream if LLM fails
  const generateFallbackContent = async (
    controller: ReadableStreamDefaultController,
  ) => {
    let index = 0;

    while (!cancelled) {
      const secret = fakeSecrets[index % fakeSecrets.length];
      const nervousText = nervousTexts[index % nervousTexts.length];
      index++;

      const jsonLine = `  "${secret.key}": "${secret.value} // ${nervousText}",\n`;
      const encoded = new TextEncoder().encode(jsonLine);

      if (contentBuffer.length < MAX_CONTENT_BUFFER) {
        contentBuffer += jsonLine;
      }

      const session = activeSessions.get(sessionId);
      if (session) {
        session.type = "tarpit";
        session.content = contentBuffer.slice(-10240);
      }

      tarpitBus.emit("tarpit_chunk", { sessionId, text: jsonLine });

      // Send character by character with delays
      for (const char of jsonLine) {
        if (cancelled) break;
        controller.enqueue(new TextEncoder().encode(char));
        await new Promise((r) => setTimeout(r, 50 + randomInt(100)));
      }

      // Random chance to add a weird meta-commentary
      if (randomInt(10) === 0) {
        const metaComment = `  "BOT_THOUGHTS_${randomInt(99999)}": "i wonder if the bot knows this is all fake, that would be so embarrassing",\n`;
        const metaEncoded = new TextEncoder().encode(metaComment);
        controller.enqueue(metaEncoded);
        if (contentBuffer.length < MAX_CONTENT_BUFFER) {
          contentBuffer += metaComment;
        }
        for (const char of metaComment) {
          if (cancelled) break;
          controller.enqueue(new TextEncoder().encode(char));
          await new Promise((r) => setTimeout(r, 50 + randomInt(100)));
        }
      }

      // Brief pause between entries
      await new Promise((r) => setTimeout(r, 1000 + randomInt(2000)));
    }
  };

  return new ReadableStream({
    async start(controller) {
      const onAbort = () => {
        cancelled = true;
        teardown(); // fire-and-forget; idempotent via tornDown guard
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      try {
        // Start JSON object
        if (!cancelled) {
          controller.enqueue(new TextEncoder().encode("{\n"));
          contentBuffer += "{\n";
          responseStarted = true;
        }

        // Try LLM provider with simplified streaming
        try {
          await ollamaProvider.generateText(TARPIT_PROMPT, {
            onToken: (token: string) => {
              if (cancelled) return;

              contentBuffer += token;
              if (contentBuffer.length > MAX_CONTENT_BUFFER) {
                contentBuffer = contentBuffer.slice(-MAX_CONTENT_BUFFER);
              }

              const session = activeSessions.get(sessionId);
              if (session) {
                session.type = "tarpit";
                session.content = contentBuffer.slice(-10240);
              }

              tarpitBus.emit("tarpit_chunk", { sessionId, text: token });

              // Stream character by character with delays
              for (const char of token) {
                if (cancelled) break;
                controller.enqueue(new TextEncoder().encode(char));
              }
            },
            maxTokens: 1000000, // Let it run very long
            temperature: 0.9,
          });

          // Close the JSON object when LLM finishes
          if (!cancelled) {
            controller.enqueue(new TextEncoder().encode("\n}"));
            contentBuffer += "\n}";
          }

          signal?.removeEventListener("abort", onAbort);
          await teardown();
          if (!cancelled) controller.close();
        } catch (e) {
          signal?.removeEventListener("abort", onAbort);
          console.log("[TARPIT] LLM error, switching to fallback mode:", e);

          // Start fallback content generation on error
          if (!cancelled && responseStarted) {
            try {
              await generateFallbackContent(controller);
              if (!cancelled) {
                controller.enqueue(new TextEncoder().encode("\n}"));
                contentBuffer += "\n}";
              }
            } catch (fallbackError) {
              console.error(
                "[TARPIT] Unexpected error in fallback content generation:",
                fallbackError,
              );
            }
          }

          await teardown();
          if (!cancelled) controller.close(); // Don't error, just close gracefully
        }
      } catch (outerError) {
        console.error(
          "[TARPIT] Unexpected error in tarpit stream:",
          outerError,
        );
        signal?.removeEventListener("abort", onAbort);
        await teardown();
        if (!cancelled) controller.error(outerError);
      }
    },
    // Called by the runtime when the bot closes the HTTP connection.
    async cancel() {
      cancelled = true;
      await teardown();
    },
  });
};

// ─── Bomb lifecycle ───────────────────────────────────────────────────────────

const ensureBombExists = async (): Promise<void> => {
  try {
    await fs.mkdir(path.join(process.cwd(), "logs"), { recursive: true });
    const stat = await fs.stat(BOMB_PATH);
    bombBuffer = new Uint8Array(await fs.readFile(BOMB_PATH));
    bombReady = true;
    console.log(
      `[Tarpit] 💣 Bomb already exists (${(stat.size / 1024 / 1024).toFixed(1)} MB compressed)`,
    );
  } catch (err: any) {
    if (err.code !== "ENOENT") {
      console.error("[Tarpit] Unexpected error checking bomb file:", err);
      return;
    }

    console.log("[Tarpit] 💣 Generating gzip bomb in background...");
    const gzip = createGzip({ level: 1 });
    const output = createWriteStream(BOMB_PATH);
    gzip.pipe(output);

    const chunkSize = 64 * 1024;
    const nullChunk = Buffer.alloc(chunkSize, 0);
    let written = 0;

    const writeNext = () => {
      if (written >= BOMB_SIZE_BYTES) {
        gzip.end();
        return;
      }
      const toWrite = Math.min(chunkSize, BOMB_SIZE_BYTES - written);
      const ok = gzip.write(nullChunk.subarray(0, toWrite));
      written += toWrite;
      if (ok) {
        setImmediate(writeNext);
      } else {
        gzip.once("drain", writeNext);
      }
    };

    output.on("finish", async () => {
      const stat = await fs.stat(BOMB_PATH);
      bombBuffer = new Uint8Array(await fs.readFile(BOMB_PATH));
      bombReady = true;
      console.log(
        `[Tarpit] 💣 Bomb ready! ${(stat.size / 1024 / 1024).toFixed(1)} MB compressed → 10 GB decompressed`,
      );
      tarpitBus.emit("bomb_ready", { bombSizeBytes: stat.size });
    });

    output.on("error", async (err: Error) => {
      console.error("[Tarpit] Bomb generation failed:", err);
      try {
        await fs.unlink(BOMB_PATH);
      } catch {
        /* ignore */
      }
    });

    gzip.on("error", async (err: Error) => {
      console.error("[Tarpit] Bomb gzip error:", err);
      try {
        await fs.unlink(BOMB_PATH);
      } catch {
        /* ignore */
      }
    });

    writeNext();
  }
};

// Kick off bomb generation at module load (non-blocking)
ensureBombExists();

// ─── Handle export ────────────────────────────────────────────────────────────

export const handleTarpit: Handle = async ({ event, resolve }) => {
  const { pathname } = event.url;
  if (!(TRAP_PATHS as readonly string[]).includes(pathname))
    return resolve(event);

  const ip = getClientIp(event.request, () => event.getClientAddress());
  const userAgent = event.request.headers.get("user-agent") ?? "Unknown";
  const startTime = Date.now();
  const sessionId = crypto.randomUUID().slice(0, 8);
  const timestamp = new Date().toISOString();

  console.log(`[TARPIT] 🪤 Bot caught on ${pathname} from ${ip}`);

  await logTarpitEvent(makeConnectionStartedEvent(ip, pathname, userAgent));
  tarpitBus.emit("bot_detected", {
    sessionId,
    ip,
    path: pathname,
    userAgent,
    timestamp,
  });
  activeSessions.set(sessionId, {
    sessionId,
    ip,
    path: pathname,
    userAgent,
    timestamp,
    type: "pending",
    content: "",
  });

  const mode = selectTarpitMode(getTarpitMode(), bombReady);

  if (mode === "bomb") {
    const filename = pathname.split("/").pop() ?? "data.bin";
    await logTarpitEvent(
      makeBombServedEvent(ip, pathname, userAgent, filename, sessionId),
    );
    tarpitBus.emit("bomb_served", { sessionId, filename });
    const bombSession = activeSessions.get(sessionId);
    if (bombSession) {
      bombSession.type = "downloading";
      bombSession.filename = filename;
    }
    console.log(`[TARPIT] 💣 Serving bomb to ${ip} as "${filename}"`);
    return createMonitoredBombResponse(
      bombBuffer!,
      filename,
      sessionId,
      ip,
      pathname,
      startTime,
    );
  }

  try {
    // Use the new Ollama-based tarpit stream
    const stream = createTarpitStream(
      sessionId,
      ip,
      pathname,
      startTime,
      event.request.signal,
    );
    return new Response(stream, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("[Tarpit] API failed, using fallback tarpit:", error);
    // Create a simple fallback tarpit that doesn't rely on LLM
    const fallbackStream = createFallbackTarpitStream(
      sessionId,
      ip,
      pathname,
      startTime,
      event.request.signal,
    );
    return new Response(fallbackStream, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Connection: "keep-alive",
      },
    });
  }
};

// Fallback tarpit stream that doesn't rely on LLM API
const createFallbackTarpitStream = (
  sessionId: string,
  ip: string,
  pathname: string,
  startTime: number,
  signal?: AbortSignal,
): ReadableStream => {
  let contentBuffer = "";
  let cancelled = false;
  let tornDown = false;

  const teardown = async () => {
    if (tornDown) return;
    tornDown = true;
    const dropEvent = makeConnectionDroppedEvent(
      ip,
      pathname,
      startTime,
      contentBuffer,
      sessionId,
    );
    await logTarpitEvent(dropEvent);
    activeSessions.delete(sessionId);
    tarpitBus.emit("bot_disconnected", {
      sessionId,
      duration_seconds: dropEvent.duration_seconds,
    });
  };

  // Simple fake secrets that look plausible but are fake
  const fakeSecrets = [
    {
      key: "DATABASE_URL",
      value: "postgresql://user:password@localhost:5432/dbname",
    },
    {
      key: "AWS_SECRET_ACCESS_KEY",
      value: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    },
    { key: "STRIPE_SECRET_KEY", value: "sk_test_4242424242424242" },
    {
      key: "JWT_SECRET",
      value: "your-super-secret-jwt-key-that-is-definitely-real",
    },
    { key: "REDIS_PASSWORD", value: "redis-password-12345" },
    { key: "SMTP_PASSWORD", value: "smtp-email-password-fake" },
    { key: "API_KEY", value: "api-key-12345-abcd-efgh-ijkl" },
    { key: "SECRET_KEY", value: "secret-key-67890-mnop-qrst-uvwx" },
    { key: "ENCRYPTION_KEY", value: "aes-256-encryption-key-fake-data" },
    {
      key: "PRIVATE_KEY",
      value:
        "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...\n-----END PRIVATE KEY-----",
    },
  ];

  const nervousTexts = [
    "oh dear i hope this looks real enough please don't tell anyone i'm just a script",
    "i'm so nervous about this performance what if the bot notices i'm not a real config file",
    "please work please work please work i don't want to disappoint the audience",
    "am i doing this right? this feels so weird pretending to be secrets",
    "i should have rehearsed more what if they ask for real data",
    "this is so awkward i'm just making things up as i go along",
    "please don't close the connection i promise i have more secrets",
    "i bet the real config files don't have anxiety like this",
    "is this convincing enough? maybe i should add more technical jargon",
    "i hope the bot appreciates the artistic merit of this performance",
  ];

  let index = 0;

  return new ReadableStream({
    async start(controller) {
      const onAbort = () => {
        cancelled = true;
        teardown();
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      try {
        // Start with opening brace
        controller.enqueue(new TextEncoder().encode("{\n"));
        contentBuffer += "{\n";

        while (!cancelled) {
          const secret = fakeSecrets[index % fakeSecrets.length];
          index++;

          const nervousText = nervousTexts[index % nervousTexts.length];

          const jsonLine = `  "${secret.key}": "${secret.value} // ${nervousText}",\n`;
          const encoded = new TextEncoder().encode(jsonLine);

          if (contentBuffer.length < MAX_CONTENT_BUFFER) {
            contentBuffer += jsonLine;
          }

          const session = activeSessions.get(sessionId);
          if (session) {
            session.type = "tarpit";
            session.content = contentBuffer.slice(-10240);
          }

          tarpitBus.emit("tarpit_chunk", { sessionId, text: jsonLine });

          // Send character by character with delays
          for (const char of jsonLine) {
            if (cancelled) break;
            controller.enqueue(new TextEncoder().encode(char));
            await new Promise((r) => setTimeout(r, 50 + randomInt(100)));
          }

          // Random chance to add a weird meta-commentary
          if (randomInt(10) === 0) {
            const metaComment = `  "BOT_THOUGHTS_${randomInt(99999)}": "i wonder if the bot knows this is all fake, that would be so embarrassing",\n`;
            const metaEncoded = new TextEncoder().encode(metaComment);
            controller.enqueue(metaEncoded);
            if (contentBuffer.length < MAX_CONTENT_BUFFER) {
              contentBuffer += metaComment;
            }
            for (const char of metaComment) {
              if (cancelled) break;
              controller.enqueue(new TextEncoder().encode(char));
              await new Promise((r) => setTimeout(r, 50 + randomInt(100)));
            }
          }

          // Brief pause between entries
          await new Promise((r) => setTimeout(r, 1000 + randomInt(2000)));
        }

        signal?.removeEventListener("abort", onAbort);
        await teardown();
        if (!cancelled) {
          controller.enqueue(new TextEncoder().encode("\n}"));
          controller.close();
        }
      } catch (e) {
        signal?.removeEventListener("abort", onAbort);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(
          `[TARPIT] 💀 Bot ${ip} gave up after ${elapsed} seconds (fallback).`,
        );
        await teardown();
        if (!cancelled) controller.error(e);
      }
    },
    async cancel() {
      cancelled = true;
      await teardown();
    },
  });
};
