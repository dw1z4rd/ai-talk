import { sequence } from "@sveltejs/kit/hooks";
import { handleWsInit } from "$lib/server/ws-init";
import { handleTarpit } from "$lib/server/tarpit";
import { handleAdminAuth } from "$lib/server/admin-auth";
import { handleOtherRoutes } from "$lib/server/other-routes";

export const handle = sequence(
  handleWsInit,
  handleTarpit,
  handleAdminAuth,
  handleOtherRoutes,
);
