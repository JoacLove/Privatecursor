import "dotenv/config";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}. Fill it in .env (see .env.example).`);
  }
  return value;
}

export function getConfig() {
  const endpoint = required("HAVIAN_ENDPOINT").replace(/\/$/, "");
  return {
    endpoint,
    apiKey: required("HAVIAN_API_KEY"),
    authKey: required("HAVIAN_AUTH_KEY"),
    authHeader: process.env.HAVIAN_AUTH_HEADER?.trim() || "AuthKey",
    version: process.env.HAVIAN_VERSION?.trim() || "v1",
  };
}

/**
 * GET data from Havian public API.
 * @param {object} params
 * @param {string} params.function - e.g. project, vessel, hse
 * @param {string} params.action - e.g. get, getTimingTrack
 * @param {string} [params.format]
 * @param {Record<string, string | number | boolean | Array<string|number>>} [params.extra]
 */
export async function havianGet({
  function: fn,
  action,
  format = "json",
  extra = {},
}) {
  if (!fn || !action) {
    throw new Error("Both function and action are required.");
  }

  const { endpoint, apiKey, authKey, authHeader, version } = getConfig();
  const url = new URL(`${endpoint}/${version}/`);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("function", fn);
  url.searchParams.set("action", action);
  url.searchParams.set("format", format);

  for (const [key, value] of Object.entries(extra)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(`${key}[]`, String(item));
      }
    } else if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: format === "json" ? "application/json" : "application/xml",
      [authHeader]: authKey,
    },
  });

  const text = await response.text();
  let body = text;
  if (format === "json") {
    try {
      body = JSON.parse(text);
    } catch {
      // keep raw text if server returned non-JSON
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    url: url.toString().replace(apiKey, "***"),
    body,
  };
}
