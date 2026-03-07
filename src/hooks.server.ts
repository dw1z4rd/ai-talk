import { sequence } from '@sveltejs/kit/hooks';
import { handleWsInit } from '$lib/server/ws-init';
import { handleTarpit } from '$lib/server/tarpit';
import { handleAdminAuth } from '$lib/server/admin-auth';

export const handle = sequence(handleWsInit, handleTarpit, handleAdminAuth);