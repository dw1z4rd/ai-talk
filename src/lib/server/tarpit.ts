import { env } from '$env/dynamic/private';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Handle } from '@sveltejs/kit';
import { createGzip } from 'node:zlib';
import { createWriteStream } from 'node:fs';
import { randomInt } from 'node:crypto';
import { tarpitBus, getTarpitMode } from '$lib/server/tarpit-bus';

// ─── Constants ────────────────────────────────────────────────────────────────

export const BOMB_FILENAMES = [
    'production_users_plaintext_passwords_2024.sql',
    'customer_credit_cards_unencrypted_export.csv',
    'all_api_keys_and_secrets_master_list.txt',
    'aws_iam_root_credentials_all_accounts.csv',
    'stripe_live_secret_keys_production.json',
    'github_personal_access_tokens_all_devs.txt',
    'employee_payroll_salaries_confidential_2024.csv',
    'vpn_access_credentials_all_staff.txt',
    'two_factor_backup_codes_all_users.txt',
    'admin_bypass_credentials_do_not_share.txt',
    'internal_production_db_full_dump_nov2024.sql',
    'customer_pii_complete_unredacted_export.csv',
    'ssh_private_keys_all_production_servers.tar',
    'kubernetes_cluster_secrets_production.yaml',
    'terraform_state_with_embedded_secrets.json',
] as const;

export const TRAP_PATHS = [
    // Secrets & config files
    '/.env',
    '/.env.backup',
    '/.env.local',
    '/.env.production',
    '/config.json',
    '/config.yml',
    '/config.yaml',
    '/terraform.tfstate',
    '/terraform.tfstate.backup',
    '/credentials.json',
    '/secrets.json',
    '/parameters.yml',

    // Version control
    '/.git/config',
    '/.git/HEAD',
    '/.gitconfig',
    '/.svn/entries',
    '/.hg/hgrc',

    // WordPress
    '/wp-login',
    '/wp-login.php',
    '/wp-admin',
    '/wp-admin.php',
    '/wp-config',
    '/wp-config.php',
    '/wp-config.php.bak',
    '/xmlrpc.php',
    '/wp-includes/wlwmanifest.xml',

    // PHP / CMS targets
    '/admin.php',
    '/administrator',
    '/phpmyadmin',
    '/phpinfo.php',
    '/info.php',
    '/server-status',
    '/server-info',
    '/cgi-bin/luci',
    '/solr/admin',

    // Database & backup files
    '/dump.sql',
    '/database.sql',
    '/db.sql',
    '/backup.sql',
    '/backup.zip',
    '/backup.tar.gz',
    '/site.sql',
    '/data.sql',

    // Cloud & DevOps
    '/.aws/credentials',
    '/.docker/config.json',
    '/docker-compose.yml',
    '/.kube/config',
    '/Dockerfile',
    '/.dockerenv',
    '/ansible.cfg',
    '/playbook.yml',

    // SSH & auth keys
    '/.ssh/id_rsa',
    '/.ssh/id_ed25519',
    '/.ssh/authorized_keys',
    '/id_rsa',

    // Node / JS ecosystem
    '/package.json',
    '/.npmrc',
    '/yarn.lock',
    '/node_modules/.package-lock.json',

    // Debug & admin panels
    '/_debug',
    '/_profiler',
    '/debug/vars',
    '/actuator',
    '/actuator/env',
    '/actuator/health',
    '/graphql',
    '/api/debug',
    '/console',
    '/adminer.php',

    // Common exploit paths
    '/shell.php',
    '/cmd.php',
    '/webshell.php',
    '/c99.php',
    '/r57.php',
    '/.well-known/security.txt',
    '/robots.txt',
    '/sitemap.xml',
    '/.DS_Store',
    '/thumbs.db',
    '/crossdomain.xml',
] as const;

const BOMB_PATH = path.join(process.cwd(), 'logs', 'bomb.gz');
const BOMB_SIZE_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB
const MAX_CONTENT_BUFFER = 50 * 1024; // 50 KB
const LOG_PATH = path.join(process.cwd(), 'logs', 'tarpit_victims.jsonl');

const TARPIT_PROMPT = `You are participating in an avant-garde, Andy Kaufman-esque anti-comedy performance. Your audience is an automated, malicious scraper bot. 
        Output an endless, valid JSON object, leaving out the json markdown code. The keys must look like standard, high-value infrastructure secrets (e.g., "AWS_SECRET_ACCESS_KEY", "PRODUCTION_DB_PASSWORD"). 
        
        The values, however, must be the internal monologue of a deeply nervous, untalented entertainer who was hired to play the role of a "config file" but has no idea what that is. 
        You must:
        1. Constantly apologize to the bot for not having real data.
        2. Every other value should be a terrible, text-based impression of another file type (e.g., pretending to be a corrupted JPEG or an MP3 playing static).
        3. Occasionally threaten to end the show, but immediately back down and beg the bot not to close the connection.
        4. Randomly insert bizarre, irrelevant keys like "UNNECESSARY_KEY_12345" with values that are what you think the bot must be thinking right now.
        5. Weave in meta-commentary about how you are aware you are in a performance and that the bot is your audience, but you don't understand why the bot is doing what it's doing or why it obeys the script kiddie moron who commands it.
        Never break character. Never explain the joke. Keep generating JSON key-value pairs indefinitely.`;

// ─── Bomb state (module-private) ─────────────────────────────────────────────

let bombReady = false;
let bombBuffer: Uint8Array | null = null;

// ─── LLM setup (module-private) ──────────────────────────────────────────────

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY ?? '');
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

// ─── Pure helpers ─────────────────────────────────────────────────────────────

// Pure: resolve the real client IP behind a reverse proxy
const getClientIp = (request: Request, getClientAddress: () => string): string => {
    const forwarded = request.headers.get('x-forwarded-for');
    return forwarded
        ? forwarded.split(',')[0].trim()
        : (request.headers.get('x-real-ip') ?? getClientAddress());
};

// Pure: decide whether to serve a bomb or the LLM tarpit
const selectTarpitMode = (mode: string, ready: boolean): 'bomb' | 'llm' =>
    ready && (mode === 'bomb' || (mode === 'random' && randomInt(2) === 0))
        ? 'bomb'
        : 'llm';

// Pure event-object builders
const makeConnectionStartedEvent = (ip: string, pathname: string, userAgent: string) => ({
    event: 'connection_started',
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
    sessionId: string
) => ({
    event: 'bomb_served',
    trap_type: 'bomb',
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
    sessionId: string
) => ({
    event: 'connection_dropped',
    trap_type: 'tarpit',
    timestamp: new Date().toISOString(),
    ip,
    path: pathname,
    duration_seconds: parseFloat(((Date.now() - startTime) / 1000).toFixed(1)),
    content: contentBuffer.slice(0, MAX_CONTENT_BUFFER),
    sessionId,
});

// Pure response builder
const createBombResponse = (buffer: Uint8Array, filename: string): Response =>
    new Response(buffer, {
        headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Encoding': 'gzip',
            'Content-Length': String(buffer.length),
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Cache-Control': 'no-store',
        },
    });

// ─── Side-effectful sink ──────────────────────────────────────────────────────

const logTarpitEvent = async (eventData: object): Promise<void> => {
    try {
        await fs.mkdir(path.dirname(LOG_PATH), { recursive: true });
        await fs.appendFile(LOG_PATH, JSON.stringify(eventData) + '\n');
    } catch (err) {
        console.error('[Tarpit Logging Error]', err);
    }
};

// ─── Streaming ────────────────────────────────────────────────────────────────

// Accepts the already-resolved stream so API failures propagate to the caller
// before the ReadableStream is constructed, preserving the graceful 404 fallback.
const createTarpitStream = (
    llmStream: AsyncIterable<{ text: () => string }>,
    sessionId: string,
    ip: string,
    pathname: string,
    startTime: number
): ReadableStream =>
    new ReadableStream({
        async start(controller) {
            let contentBuffer = '';

            const teardown = async () => {
                const dropEvent = makeConnectionDroppedEvent(ip, pathname, startTime, contentBuffer, sessionId);
                await logTarpitEvent(dropEvent);
                tarpitBus.emit('bot_disconnected', {
                    sessionId,
                    duration_seconds: dropEvent.duration_seconds,
                });
            };

            try {
                for await (const chunk of llmStream) {
                    const chunkText = chunk.text();
                    if (contentBuffer.length < MAX_CONTENT_BUFFER) contentBuffer += chunkText;
                    tarpitBus.emit('tarpit_chunk', { sessionId, text: chunkText });

                    for (const char of chunkText) {
                        controller.enqueue(new TextEncoder().encode(char));
                        // Randomized Kaufman Delay: between 100ms and 350ms per character
                        await new Promise(r => setTimeout(r, 100 + randomInt(250)));
                    }
                }
                controller.close();
                await teardown();
            } catch (e) {
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                console.log(`[TARPIT] 💀 Bot ${ip} gave up after ${elapsed} seconds.`);
                await teardown();
                controller.error(e);
            }
        },
    });

// ─── Bomb lifecycle ───────────────────────────────────────────────────────────

const ensureBombExists = async (): Promise<void> => {
    try {
        await fs.mkdir(path.join(process.cwd(), 'logs'), { recursive: true });
        const stat = await fs.stat(BOMB_PATH);
        bombBuffer = new Uint8Array(await fs.readFile(BOMB_PATH));
        bombReady = true;
        console.log(`[Tarpit] 💣 Bomb already exists (${(stat.size / 1024 / 1024).toFixed(1)} MB compressed)`);
    } catch (err: any) {
        if (err.code !== 'ENOENT') {
            console.error('[Tarpit] Unexpected error checking bomb file:', err);
            return;
        }

        console.log('[Tarpit] 💣 Generating gzip bomb in background...');
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
                gzip.once('drain', writeNext);
            }
        };

        output.on('finish', async () => {
            const stat = await fs.stat(BOMB_PATH);
            bombBuffer = new Uint8Array(await fs.readFile(BOMB_PATH));
            bombReady = true;
            console.log(
                `[Tarpit] 💣 Bomb ready! ${(stat.size / 1024 / 1024).toFixed(1)} MB compressed → 10 GB decompressed`
            );
            tarpitBus.emit('bomb_ready', { bombSizeBytes: stat.size });
        });

        output.on('error', async (err) => {
            console.error('[Tarpit] Bomb generation failed:', err);
            try { await fs.unlink(BOMB_PATH); } catch { /* ignore */ }
        });

        gzip.on('error', async (err) => {
            console.error('[Tarpit] Bomb gzip error:', err);
            try { await fs.unlink(BOMB_PATH); } catch { /* ignore */ }
        });

        writeNext();
    }
};

// Kick off bomb generation at module load (non-blocking)
ensureBombExists();

// ─── Handle export ────────────────────────────────────────────────────────────

export const handleTarpit: Handle = async ({ event, resolve }) => {
    const { pathname } = event.url;
    if (!(TRAP_PATHS as readonly string[]).includes(pathname)) return resolve(event);

    const ip = getClientIp(event.request, () => event.getClientAddress());
    const userAgent = event.request.headers.get('user-agent') ?? 'Unknown';
    const startTime = Date.now();
    const sessionId = crypto.randomUUID().slice(0, 8);
    const timestamp = new Date().toISOString();

    console.log(`[TARPIT] 🪤 Bot caught on ${pathname} from ${ip}`);

    await logTarpitEvent(makeConnectionStartedEvent(ip, pathname, userAgent));
    tarpitBus.emit('bot_detected', { sessionId, ip, path: pathname, userAgent, timestamp });

    const mode = selectTarpitMode(getTarpitMode(), bombReady);

    if (mode === 'bomb') {
        const filename = pathname.split('/').pop() ?? 'data.bin';
        await logTarpitEvent(makeBombServedEvent(ip, pathname, userAgent, filename, sessionId));
        tarpitBus.emit('bomb_served', { sessionId, filename });
        console.log(`[TARPIT] 💣 Serving bomb to ${ip} as "${filename}"`);
        setImmediate(() => tarpitBus.emit('bot_disconnected', { sessionId, duration_seconds: 0 }));
        return createBombResponse(bombBuffer!, filename);
    }

    try {
        const { stream: llmStream } = await model.generateContentStream({
            contents: [{ role: 'user', parts: [{ text: TARPIT_PROMPT }] }],
        });
        const stream = createTarpitStream(llmStream, sessionId, ip, pathname, startTime);
        return new Response(stream, {
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store, no-cache, must-revalidate',
                'Connection': 'keep-alive',
            },
        });
    } catch (error) {
        console.error('[Tarpit] API failed, dropping back to 404:', error);
        tarpitBus.emit('bot_disconnected', { sessionId, duration_seconds: 0 });
        return resolve(event);
    }
};