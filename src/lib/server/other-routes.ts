import { error } from "@sveltejs/kit";
import type { Handle } from "@sveltejs/kit";

const disabledRoutes = ["/assistant", "/escape-room", "/story", "/stories"];

export const handleOtherRoutes: Handle = async ({ event, resolve }) => {
  const path = event.url.pathname;

  // Safely checks for exact match OR a sub-route (e.g., /story or /story/1)
  // without accidentally blocking routes like /storyboard
  const isBlocked = disabledRoutes.some(
    (route) => path === route || path.startsWith(`${route}/`),
  );

  if (isBlocked) {
    throw error(404, "Not Found");
  }

  return resolve(event);
};
