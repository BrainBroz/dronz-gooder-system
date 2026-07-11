export const REFRESH_COOKIE = "dronz_refresh_token";

function attributes() {
  return ["HttpOnly", "Path=/", "SameSite=Lax", ...(process.env.NODE_ENV === "production" ? ["Secure"] : [])];
}

export function authCookie(token: string, expiresAt: Date) {
  return [`${REFRESH_COOKIE}=${token}`, ...attributes(), `Expires=${expiresAt.toUTCString()}`].join("; ");
}

export function clearAuthCookie() {
  return [`${REFRESH_COOKIE}=`, ...attributes(), "Expires=Thu, 01 Jan 1970 00:00:00 GMT"].join("; ");
}

export function readRefreshCookie(header: string | undefined) {
  if (!header) return undefined;
  const entry = header.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${REFRESH_COOKIE}=`));
  return entry ? decodeURIComponent(entry.slice(REFRESH_COOKIE.length + 1)) : undefined;
}
