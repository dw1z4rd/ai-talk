import { fail, redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import { deriveSessionToken, COOKIE_NAME } from '$lib/server/admin-auth';
import type { Actions, PageServerLoad } from './$types';

// Sanitise the redirect target: only allow paths under /admin
const safeRedirect = (raw: string | null): string => {
    if (!raw) return '/admin/tarpit';
    const decoded = decodeURIComponent(raw);
    return decoded.startsWith('/admin') ? decoded : '/admin/tarpit';
};

export const load: PageServerLoad = async ({ cookies, url }) => {
    // Already authenticated? Skip straight to the admin panel.
    const session = cookies.get(COOKIE_NAME) ?? '';
    const expected = await deriveSessionToken(env.ADMIN_PASSWORD ?? '');
    if (session.length === expected.length && session === expected) {
        redirect(302, safeRedirect(url.searchParams.get('redirect')));
    }
    return {};
};

export const actions: Actions = {
    default: async ({ request, cookies, url }) => {
        const data = await request.formData();
        const password = (data.get('password') as string | null) ?? '';

        if (!password) {
            return fail(400, { error: 'Password required.' });
        }

        const expected = await deriveSessionToken(env.ADMIN_PASSWORD ?? '');
        const provided = await deriveSessionToken(password);

        // Both are 64-char hex strings — safe to compare lengths then values.
        // deriveSessionToken already uses HMAC so the raw password is never
        // transmitted or stored; we're comparing derived tokens here.
        if (provided.length !== expected.length || provided !== expected) {
            return fail(401, { error: 'Access denied.' });
        }

        cookies.set(COOKIE_NAME, expected, {
            path: '/admin',
            httpOnly: true,
            sameSite: 'strict',
            secure: !dev,
            maxAge: 60 * 60 * 24 * 30, // 30 days
        });

        redirect(302, safeRedirect(url.searchParams.get('redirect')));
    },
};