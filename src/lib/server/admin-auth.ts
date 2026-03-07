import { env } from '$env/dynamic/private';
import type { Handle } from '@sveltejs/kit';

// Pure: build the expected Basic auth header value
const buildExpectedAuth = (password: string): string =>
    `Basic ${btoa(`admin:${password}`)}`;

// Pure: extract the Authorization header from a request
const getAuthHeader = (request: Request): string | null =>
    request.headers.get('Authorization');

export const handleAdminAuth: Handle = async ({ event, resolve }) => {
    if (!event.url.pathname.startsWith('/admin')) return resolve(event);

    const expected = buildExpectedAuth(env.ADMIN_PASSWORD ?? '');
    const provided = getAuthHeader(event.request);

    if (provided !== expected) {
        console.log(
            `[SECURITY] Blocked unauthorized access to ${event.url.pathname} from IP: ${event.getClientAddress()}`
        );
        return new Response('Access Denied. The logs are classified.', {
            status: 401,
            headers: { 'WWW-Authenticate': 'Basic realm="Tarpit Command Center"' },
        });
    }

    return resolve(event);
};