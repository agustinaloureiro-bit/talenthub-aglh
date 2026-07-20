type BuscojobsConfig = Record<string, unknown>;

export type BuscojobsAuth = {
  authorization: string | null;
  sessionId: string | null;
  empresaId: string;
};

export type BuscojobsLogin = {
  auth: BuscojobsAuth;
  configUpdate: Record<string, unknown>;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function textOrNull(value: unknown) {
  const text = clean(value);
  return text || null;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const payload = token.split(".")[1];
    if (!payload) return {};
    return JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return {};
  }
}

function cookieHeaderFromResponse(response: Response) {
  const values = response.headers.getSetCookie?.() ?? [];
  return values.map((value) => value.split(";", 1)[0]).filter(Boolean).join("; ");
}

function mergeCookieHeaders(...headers: Array<string | null | undefined>) {
  const pairs = new Map<string, string>();
  for (const header of headers) {
    for (const pair of clean(header).split(";")) {
      const trimmed = pair.trim();
      if (!trimmed || !trimmed.includes("=")) continue;
      pairs.set(trimmed.split("=")[0], trimmed);
    }
  }
  return [...pairs.values()].join("; ");
}

function cookieValue(header: string, name: string) {
  const pair = header.split(";").map((value) => value.trim()).find((value) => value.startsWith(`${name}=`));
  if (!pair) return null;
  const raw = pair.slice(name.length + 1);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function formFieldsFromHtml(html: string) {
  const fields = new URLSearchParams();
  for (const match of html.matchAll(/<input\b[^>]*>/gi)) {
    const input = match[0];
    const name = input.match(/name=["']([^"']*)["']/i)?.[1];
    const value = input.match(/value=["']([^"']*)["']/i)?.[1] ?? "";
    if (name) fields.set(name, value);
  }
  return fields;
}

export function buscojobsAuthFromConfig(config: BuscojobsConfig): BuscojobsAuth {
  const raw = [config.sessionCookies, config.cookies, config.cookie, config.apiKey, config.accessToken, config.token]
    .map(clean)
    .filter(Boolean)
    .join("\n");
  const authorization = raw.match(/authorization:\s*Bearer\s+([^\s"^]+)/i)?.[1]
    ?? raw.match(/Bearer\s+([A-Za-z0-9._-]+)/)?.[1]
    ?? textOrNull(clean(config.apiKey).replace(/^Bearer\s+/i, ""))
    ?? textOrNull(clean(config.accessToken).replace(/^Bearer\s+/i, ""))
    ?? textOrNull(clean(config.token).replace(/^Bearer\s+/i, ""));
  const cookieSession = raw.match(/ASP\.NET_SessionId=([^;"\s]+)/i)?.[1];
  let sessionId = raw.match(/sessionid:\s*([^\s"^]+)/i)?.[1] ?? (clean(config.sessionId) || cookieSession || null);
  if (sessionId) {
    try {
      sessionId = decodeURIComponent(sessionId.replace(/\^/g, ""));
    } catch {
      sessionId = sessionId.replace(/\^/g, "");
    }
  }
  const payload = authorization ? decodeJwtPayload(authorization) : {};
  const empresaId = clean(
    config.empresaId
    ?? config.companyId
    ?? payload.EmpresaId
    ?? payload.empresaId
    ?? payload.IdEmpresa
    ?? raw.match(/\/empresas\/(\d+)\//i)?.[1]
    ?? "119341"
  );
  return { authorization: authorization || null, sessionId, empresaId };
}

export async function loginBuscojobs(config: BuscojobsConfig): Promise<BuscojobsLogin | null> {
  const username = clean(config.username ?? config.email ?? config.user);
  const password = clean(config.password);
  if (!username || !password) return null;

  const loginUrl = "https://www.buscojobs.com.uy/login";
  const loginPage = await fetch(loginUrl, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36"
    },
    redirect: "manual"
  });
  const html = await loginPage.text();
  let cookies = cookieHeaderFromResponse(loginPage);
  const fields = formFieldsFromHtml(html);
  fields.set("username", username);
  fields.set("password", password);
  fields.set("remember-me", "on");
  if (!fields.has("redirectUrl")) fields.set("redirectUrl", "");

  const action = new URL(html.match(/<form\b[^>]*action=["']([^"']+)["']/i)?.[1] ?? "/login", loginUrl);
  const response = await fetch(action, {
    method: "POST",
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookies,
      origin: action.origin,
      referer: loginUrl,
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36"
    },
    body: fields,
    redirect: "manual"
  });
  cookies = mergeCookieHeaders(cookies, cookieHeaderFromResponse(response));
  const sessionId = cookieValue(cookies, "ASP.NET_SessionId");
  if (!sessionId || (response.status !== 302 && !response.ok)) return null;

  const tokenResponse = await fetch("https://api.buscojobs.com/v3/uy/api/usuarios/token", {
    method: "POST",
    headers: {
      accept: "application/json, text/plain, */*",
      SessionId: sessionId,
      origin: "https://www.buscojobs.com.uy",
      referer: "https://www.buscojobs.com.uy/"
    }
  });
  const tokenPayload = await tokenResponse.json().catch(() => ({}));
  const token = clean(tokenPayload.id ?? tokenPayload.token ?? tokenPayload.accessToken);
  if (!tokenResponse.ok || !token) return null;
  const payload = decodeJwtPayload(token);
  const empresaId = clean(payload.EmpresaId ?? payload.empresaId ?? payload.IdEmpresa ?? config.empresaId ?? config.companyId ?? "119341");
  const now = new Date().toISOString();
  const configUpdate = {
    apiKey: `Bearer ${token}`,
    sessionCookies: cookies,
    sessionId,
    empresaId,
    sessionStatus: "connected",
    sessionRefreshedAt: now,
    sessionLastError: null
  };
  return {
    auth: { authorization: token, sessionId, empresaId },
    configUpdate
  };
}

function authHeaders(auth: BuscojobsAuth) {
  return {
    accept: "application/json, text/plain, */*",
    "accept-language": "es",
    authorization: `Bearer ${auth.authorization}`,
    origin: "https://www.buscojobs.com.uy",
    referer: "https://www.buscojobs.com.uy/",
    sessionid: auth.sessionId ?? "",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36",
    "x-timezone-offset": "180"
  };
}

export async function fetchBuscojobsAuthorized(url: string, config: BuscojobsConfig, init: RequestInit = {}) {
  let auth = buscojobsAuthFromConfig(config);
  let configUpdate: Record<string, unknown> = {};
  if (!auth.authorization) {
    const login = await loginBuscojobs(config);
    if (!login) throw new Error("Buscojobs no pudo iniciar sesion con las credenciales guardadas.");
    auth = login.auth;
    configUpdate = login.configUpdate;
  }

  const request = () => fetch(url, {
    ...init,
    headers: { ...authHeaders(auth), ...(init.headers ?? {}) }
  });
  let response = await request();
  if (response.status === 401 && clean(config.username ?? config.email ?? config.user) && clean(config.password)) {
    const login = await loginBuscojobs(config);
    if (login) {
      auth = login.auth;
      configUpdate = login.configUpdate;
      response = await request();
    }
  }
  return { response, auth, configUpdate };
}

export async function downloadBuscojobsCv(config: BuscojobsConfig, offerId: string, postulationId: string) {
  const url = `https://api.buscojobs.com/v3/uy/api/ofertas/${encodeURIComponent(offerId)}/postulaciones/${encodeURIComponent(postulationId)}/curriculum-pdf`;
  return fetchBuscojobsAuthorized(url, config);
}
