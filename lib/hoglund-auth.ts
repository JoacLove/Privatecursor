const BASE = "https://api.hoglund.no/v2";
const SESSION_TTL_MS = 30 * 60 * 1000;

type Session = { headers: Record<string, string>; expiresAt: number };

let session: Session | null = null;
let pending: Promise<Session> | null = null;

const TOKEN_KEYS = [
  "token",
  "user_token",
  "access_token",
  "accessToken",
  "auth_token",
  "api_token",
  "jwt",
];

function findToken(value: unknown, depth = 0): string | null {
  if (typeof value === "string")
    return depth === 0 && value.trim() !== "" ? value.trim() : null;
  if (depth > 3 || value == null || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  for (const key of TOKEN_KEYS) {
    const v = obj[key];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  for (const v of Object.values(obj)) {
    const found = findToken(v, depth + 1);
    if (found) return found;
  }
  return null;
}

async function apiMessage(res: Response): Promise<string | null> {
  const body = await res.text().catch(() => "");
  try {
    const json = JSON.parse(body) as { error?: unknown; message?: unknown };
    const err = json.error;
    if (typeof err === "string") return err;
    if (
      err &&
      typeof err === "object" &&
      typeof (err as { message?: unknown }).message === "string"
    ) {
      return (err as { message: string }).message;
    }
    if (typeof json.message === "string") return json.message;
  } catch {
    /* ignore */
  }
  return null;
}

async function loginFailure(endpoint: string, res: Response): Promise<Error> {
  const detail = await apiMessage(res);
  const suffix = detail ? `: ${detail}` : "";
  return new Error(
    res.status === 401 || res.status === 403
      ? `Høglund-innlogging avvist (${endpoint} HTTP ${res.status}${suffix}) – sjekk brukernavn/passord i HOGLUND_TOKEN`
      : `Høglund-innlogging feilet (${endpoint} HTTP ${res.status}${suffix})`,
  );
}

async function postLogin(
  path: string,
  username: string,
  password: string,
): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ username, password }),
    cache: "no-store",
  });
}

async function login(username: string, password: string): Promise<Session> {
  let endpoint = "/user_tokens";
  let res = await postLogin(endpoint, username, password);
  // /sessions is only tried when /user_tokens itself is unavailable, never after a credential rejection.
  if (res.status === 404 || res.status === 405) {
    endpoint = "/sessions";
    res = await postLogin(endpoint, username, password);
  }
  if (!res.ok) throw await loginFailure(endpoint, res);

  const json: unknown = await res.json().catch(() => null);
  const token = findToken(json);
  if (token) {
    return {
      headers: { Authorization: `Bearer ${token}` },
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
  }
  const cookies = res.headers.getSetCookie?.() ?? [];
  if (cookies.length > 0) {
    const cookie = cookies.map((c) => c.split(";")[0]).join("; ");
    return {
      headers: { Cookie: cookie },
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
  }
  throw new Error(
    `Høglund-innlogging: fant ingen token i svaret fra ${endpoint} (HTTP ${res.status})`,
  );
}

async function resolveSession(
  credential: string,
  sep: number,
): Promise<Session> {
  const username = credential.slice(0, sep);
  const password = credential.slice(sep + 1);
  if (username.includes("@")) return login(username, password);

  // Minted user tokens look like `<id>:<secret>` and are sent as Bearer verbatim.
  const bearer = { Authorization: `Bearer ${credential}` };
  const probe = await fetch(`${BASE}/ships`, {
    headers: bearer,
    cache: "no-store",
  });
  if (probe.status !== 401) {
    return { headers: bearer, expiresAt: Date.now() + SESSION_TTL_MS };
  }
  try {
    return await login(username, password);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "innlogging feilet";
    throw new Error(
      `HOGLUND_TOKEN avvist som Bearer-token (/ships HTTP 401), og ${reason}`,
    );
  }
}

/**
 * HOGLUND_TOKEN is normally a Høglund user token (`<id>:<secret>` or plain), sent as Bearer.
 * `email:password` is exchanged for a user token via POST /v2/user_tokens, as is any
 * `a:b` value that Høglund rejects as a Bearer token.
 * Returns null when the variable is unset.
 */
export async function hoglundAuthHeader(): Promise<Record<
  string,
  string
> | null> {
  const credential = process.env.HOGLUND_TOKEN?.trim();
  if (!credential) return null;

  const sep = credential.indexOf(":");
  if (sep <= 0) return { Authorization: `Bearer ${credential}` };

  if (session && session.expiresAt > Date.now()) return session.headers;
  if (!pending) {
    pending = resolveSession(credential, sep)
      .then((s) => (session = s))
      .finally(() => {
        pending = null;
      });
  }
  return (await pending).headers;
}

export function resetHoglundSession(): void {
  session = null;
}

export function hoglundHttpError(label: string, status: number): Error {
  if (status === 401) resetHoglundSession();
  return new Error(
    status === 401
      ? `${label}: Høglund avviste tilgangen (HTTP 401)`
      : `${label}: HTTP ${status}`,
  );
}
