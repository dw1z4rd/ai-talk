import { env } from '$env/dynamic/private';
import type { Handle } from '@sveltejs/kit';
import { timingSafeEqual } from 'node:crypto';

export const COOKIE_NAME = 'admin_session';
const HMAC_CONTEXT = 'aitalk-admin-v1';

// Derive a stateless session token from the admin password using HMAC-SHA256.
// Rotating ADMIN_PASSWORD automatically invalidates all existing sessions.
export const deriveSessionToken = async (password: string): Promise<string> => {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(HMAC_CONTEXT));
    return Array.from(new Uint8Array(sig))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
};

// Constant-time comparison of two hex strings (both must be same length).
// Both inputs are 64-char HMAC-SHA256 hex strings, so lengths always match.
const safeEqual = (a: string, b: string): boolean => {
    if (a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
};

export const handleAdminAuth: Handle = async ({ event, resolve }) => {
    if (!event.url.pathname.startsWith('/admin')) return resolve(event);
    // Let the login page through unconditionally
    if (event.url.pathname.startsWith('/admin/login')) return resolve(event);

    const sessionCookie = event.cookies.get(COOKIE_NAME) ?? '';
    const expected = await deriveSessionToken(env.ADMIN_PASSWORD ?? '');

    if (!safeEqual(sessionCookie, expected)) {
        const redirectParam = encodeURIComponent(event.url.pathname);
        return Response.redirect(
            new URL(`/admin/login?redirect=${redirectParam}`, event.url),
            302
        );
    }

    return resolve(event);
};