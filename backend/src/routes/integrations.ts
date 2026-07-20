import express, { Router } from "express";
import { inflateRawSync } from "zlib";
import { createHash } from "crypto";
import { z } from "zod";
import { PDFParse } from "pdf-parse";
import { q } from "../db/pool.js";
import { asyncHandler } from "../middleware/errors.js";
import { requireRole } from "../middleware/auth.js";
import { config as appConfig } from "../config.js";
import { importCandidate } from "../services/candidateIngestion.js";
import { analyzeCvText } from "../services/cvAnalysis.js";
import type { AgentSyncResult, CandidateImport, SourceConnector } from "../connectors/types.js";

export const integrationsRouter = Router();
export const integrationsPublicRouter = Router();

const DEFAULT_INTEGRATIONS = [
  ["aglh", "AGLH Platform"],
  ["yoiners", "Yoiners"],
  ["buscojobs", "Buscojobs"],
  ["gmail", "Gmail"],
  ["drive", "Google Drive"],
  ["linkedin", "LinkedIn Recruiter"]
] as const;

const SYNC_ENGINE_VERSION = "2026-07-20.1";
const DEFAULT_GMAIL_QUERY = "has:attachment (filename:pdf OR filename:doc OR filename:docx OR filename:rtf OR filename:txt) newer_than:3650d";
const MAX_STORED_CV_BYTES = 8 * 1024 * 1024;

function gmailAfterDate(value: unknown) {
  const date = new Date(cleanText(value));
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() - 1);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

export function gmailSyncQueryForConfig(config: Record<string, unknown>, hasStoredQueue: boolean) {
  const explicitQuery = cleanText(config.query);
  if (explicitQuery) return { query: explicitQuery, mode: "custom", since: "" };
  const completedAt = cleanText(config.gmailBackfillCompleteAt);
  const afterDate = hasStoredQueue ? "" : gmailAfterDate(completedAt);
  if (afterDate) {
    return {
      query: `${DEFAULT_GMAIL_QUERY} after:${afterDate}`,
      mode: "incremental",
      since: afterDate
    };
  }
  return { query: DEFAULT_GMAIL_QUERY, mode: "historical", since: "" };
}

function maskConfig(config: Record<string, unknown> | null) {
  if (!config) return {};
  const masked = { ...config };
  const visibleDiagnostics = new Set([
    "sessionStatus",
    "sessionRefreshedAt",
    "sessionFailedAt",
    "sessionLastError",
    "lastAgentMessage",
    "oauthStatus",
    "syncEngineVersion",
    "connectedGoogleEmail",
    "expectedGoogleEmail",
    "gmailHasMore",
    "gmailSyncMode",
    "gmailIncrementalSince",
    "gmailHistoryId",
    "gmailHistorySyncActive",
    "gmailBackfillCompleteAt",
    "gmailHistoricalStartedAt",
    "gmailTotalMatchingMessages",
    "gmailTakeoutImportedAt",
    "gmailTakeoutLastFile"
  ]);
  for (const key of Object.keys(masked)) {
    if (visibleDiagnostics.has(key)) continue;
    if (/password|token|secret|cookie|session|key|browserStorageState|clientSecret|refreshToken/i.test(key) && masked[key]) {
      masked[key] = "********";
    }
  }
  return masked;
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function escapeHtml(value: unknown) {
  return cleanText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function textOrNull(value: unknown) {
  const text = cleanText(value);
  return text ? text : null;
}

function firstText(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const direct = textOrNull(row[key]);
    if (direct) return direct;
    const found = Object.keys(row).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    if (found) {
      const value = textOrNull(row[found]);
      if (value) return value;
    }
  }
  return null;
}

function deepFirstText(value: unknown, keys: string[], depth = 0): string | null {
  if (!value || typeof value !== "object" || depth > 4) return null;
  const row = value as Record<string, unknown>;
  const direct = firstText(row, keys);
  if (direct) return direct;
  for (const child of Object.values(row)) {
    const found = deepFirstText(child, keys, depth + 1);
    if (found) return found;
  }
  return null;
}

function firstMatchingKeyText(value: unknown, patterns: RegExp[], depth = 0): string | null {
  if (!value || typeof value !== "object" || depth > 4) return null;
  const row = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(row)) {
    const normalized = key.toLowerCase();
    if (patterns.some((pattern) => pattern.test(normalized))) {
      const text = textOrNull(child);
      if (text) return text;
    }
  }
  for (const child of Object.values(row)) {
    const found = firstMatchingKeyText(child, patterns, depth + 1);
    if (found) return found;
  }
  return null;
}

function hasMatchingKey(value: unknown, patterns: RegExp[], depth = 0): boolean {
  if (!value || typeof value !== "object" || depth > 4) return false;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => patterns.some((pattern) => pattern.test(key.toLowerCase())))) return true;
  return Object.values(row).some((child) => hasMatchingKey(child, patterns, depth + 1));
}

function listFrom(value: unknown) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  return cleanText(value)
    .split(/[;,|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(items: string[]) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function numberFromConfig(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&aacute;/g, "a")
    .replace(/&eacute;/g, "e")
    .replace(/&iacute;/g, "i")
    .replace(/&oacute;/g, "o")
    .replace(/&uacute;/g, "u")
    .replace(/&ntilde;/g, "n")
    .replace(/&Aacute;/g, "A")
    .replace(/&Eacute;/g, "E")
    .replace(/&Iacute;/g, "I")
    .replace(/&Oacute;/g, "O")
    .replace(/&Uacute;/g, "U")
    .replace(/&Ntilde;/g, "N");
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function htmlText(value: string) {
  return decodeHtml(value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(href: string, base = "https://buscojobs.com.uy") {
  try {
    return new URL(decodeHtml(href), base).toString();
  } catch {
    return null;
  }
}

function parseCsv(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const separator = lines[0].includes(";") ? ";" : ",";
  const parseLine = (line: string) => {
    const values: string[] = [];
    let current = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1];
      if (char === "\"" && quoted && next === "\"") {
        current += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = !quoted;
      } else if (char === separator && !quoted) {
        values.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    return values;
  };
  const headers = parseLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = parseLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function cookieHeaderFromConfig(config: Record<string, unknown>) {
  const raw = cleanText(config.sessionCookies ?? config.cookies ?? config.cookie);
  if (!raw) return null;

  const curlCookie = raw.match(/\s-b\s+\^?"([^"]+)"/i)?.[1]
    ?? raw.match(/\s-b\s+'([^']+)'/i)?.[1]
    ?? raw.match(/--cookie\s+\^?"([^"]+)"/i)?.[1]
    ?? raw.match(/--cookie\s+'([^']+)'/i)?.[1]
    ?? raw.match(/(?:-H|--header)\s+\^?"cookie:\s*([^"]+)"/i)?.[1]
    ?? raw.match(/(?:-H|--header)\s+'cookie:\s*([^']+)'/i)?.[1]
    ?? raw.match(/(?:^|\n|\r)cookie:\s*([^\n\r]+)/i)?.[1];
  if (curlCookie) return curlCookie.replace(/\^/g, "");

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const pairs = parsed
        .map((cookie) => `${cleanText(cookie?.name)}=${cleanText(cookie?.value)}`)
        .filter((pair) => !pair.startsWith("="));
      return pairs.length ? pairs.join("; ") : null;
    }
    if (parsed && typeof parsed === "object") {
      const headers = (parsed as any).headers ?? parsed;
      const header = headers.cookie ?? headers.Cookie;
      if (header) return cleanText(header);
    }
  } catch {
    return raw.includes("=") ? raw : null;
  }

  return raw.includes("=") ? raw : null;
}

function cookieHeaderFromResponse(response: Response) {
  const getSetCookie = (response.headers as any).getSetCookie?.() as string[] | undefined;
  const cookies = getSetCookie?.length ? getSetCookie : [response.headers.get("set-cookie") ?? ""];
  return cookies
    .flatMap((cookie) => cookie.split(/,(?=[^;,]+=)/))
    .map((cookie) => cookie.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

function mergeCookieHeaders(...headers: Array<string | null | undefined>) {
  const pairs = new Map<string, string>();
  for (const header of headers) {
    for (const pair of cleanText(header).split(";")) {
      const trimmed = pair.trim();
      if (!trimmed || !trimmed.includes("=")) continue;
      pairs.set(trimmed.split("=")[0], trimmed);
    }
  }
  return [...pairs.values()].join("; ");
}

function formFieldsFromHtml(html: string) {
  const fields = new URLSearchParams();
  const inputRegex = /<input\b[^>]*>/gi;
  const attr = (input: string, name: string) => input.match(new RegExp(`${name}=["']([^"']*)["']`, "i"))?.[1] ?? "";
  let match: RegExpExecArray | null;
  while ((match = inputRegex.exec(html))) {
    const input = match[0];
    const name = decodeHtml(attr(input, "name"));
    if (!name) continue;
    fields.set(name, decodeHtml(attr(input, "value")));
  }
  return fields;
}

async function loginBuscojobsWithCredentials(config: Record<string, unknown>) {
  const username = cleanText(config.username ?? config.email ?? config.user);
  const password = cleanText(config.password);
  if (!username || !password) return null;

  const loginUrls = unique([
    cleanText(config.loginUrl),
    "https://www.buscojobs.com.uy/login",
    "https://www.buscojobs.com.uy/empresas/login",
    "https://www.buscojobs.com.uy/login/empresa",
    "https://www.buscojobs.com.uy/empresa/login",
    "https://www.buscojobs.com.uy/app/login",
    "https://www.buscojobs.com.uy/app/empresa/login",
    "https://www.buscojobs.com.uy/ingresar",
    "https://www.buscojobs.com.uy/iniciar-sesion",
    "https://buscojobs.com.uy/login",
    "https://buscojobs.com.uy/empresas/login",
    "https://buscojobs.com.uy/login/empresa",
    "https://buscojobs.com.uy/empresa/login",
    "https://buscojobs.com.uy/app/empresa/login",
    "https://buscojobs.com.uy/ingresar",
    "https://buscojobs.com.uy/iniciar-sesion",
    "https://buscojobs.com.uy/app/login"
  ].filter(Boolean));

  for (const loginUrl of loginUrls) {
    try {
      const loginPage = await fetch(loginUrl, {
        headers: {
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36"
        },
        redirect: "follow"
      });
      const loginHtml = await loginPage.text();
      const initialCookies = cookieHeaderFromResponse(loginPage);
      const action = absoluteUrl(loginHtml.match(/<form\b[^>]*action=["']([^"']+)["']/i)?.[1] ?? loginUrl, loginUrl) ?? loginUrl;
      const fields = formFieldsFromHtml(loginHtml);
      const fieldNames = [...fields.keys()].map((name) => name.toLowerCase());
      const userField = [...fields.keys()].find((name) => /email|mail|usuario|user|login/i.test(name)) ?? "email";
      const passwordField = [...fields.keys()].find((name) => /password|pass|clave|contras/i.test(name)) ?? "password";
      fields.set(userField, username);
      fields.set(passwordField, password);
      if (!fieldNames.some((name) => /remember|recordar/.test(name))) fields.set("remember", "true");

      const response = await fetch(action, {
        method: "POST",
        headers: {
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "content-type": "application/x-www-form-urlencoded",
          cookie: initialCookies,
          origin: new URL(action).origin,
          referer: loginUrl,
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36"
        },
        body: fields,
        redirect: "follow"
      });
      const nextCookies = mergeCookieHeaders(initialCookies, cookieHeaderFromResponse(response));
      if (!nextCookies) continue;
      await fetchBuscojobs("https://buscojobs.com.uy/app/empresa/panel", nextCookies);
      return nextCookies;
    } catch {
      continue;
    }
  }

  return null;
}

function authFromConfig(config: Record<string, unknown>) {
  const raw = cleanText(config.sessionCookies ?? config.cookies ?? config.cookie ?? config.apiKey ?? config.accessToken ?? config.token);
  const authorization = raw.match(/authorization:\s*Bearer\s+([^^"\s]+)/i)?.[1]
    ?? raw.match(/-H\s+\^?"authorization:\s*Bearer\s+([^^"\s]+)/i)?.[1]
    ?? raw.match(/Bearer\s+([A-Za-z0-9._-]+)/)?.[1]
    ?? textOrNull(cleanText(config.apiKey).replace(/^Bearer\s+/i, ""))
    ?? textOrNull(cleanText(config.accessToken).replace(/^Bearer\s+/i, ""))
    ?? textOrNull(cleanText(config.token).replace(/^Bearer\s+/i, ""));
  const sessionId = raw.match(/sessionid:\s*([^^"\s]+)/i)?.[1]
    ?? raw.match(/ASP\.NET_SessionId=([^;"]+)/i)?.[1]
    ?? cleanText(config.sessionId);
  const empresaId = raw.match(/\/empresas\/(\d+)\//i)?.[1]
    ?? raw.match(/"empresaId":(\d+)/i)?.[1]
    ?? cleanText(config.empresaId)
    ?? cleanText(config.companyId)
    ?? "119341";

  return {
    authorization: authorization || null,
    sessionId: sessionId?.replace(/\^/g, "") || null,
    empresaId
  };
}

function decodeJwtPayload(token: string) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return {};
    return JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return {};
  }
}

function collectIdsFromObject(value: unknown, patterns: RegExp[], depth = 0): string[] {
  if (!value || typeof value !== "object" || depth > 4) return [];
  const ids: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (patterns.some((pattern) => pattern.test(key)) && /^\d+$/.test(cleanText(child))) ids.push(cleanText(child));
    ids.push(...collectIdsFromObject(child, patterns, depth + 1));
  }
  return ids;
}

function buscojobsEmpresaIds(config: Record<string, unknown>) {
  const auth = authFromConfig(config);
  const raw = cleanText(config.sessionCookies ?? config.cookies ?? config.cookie ?? config.apiKey ?? config.accessToken ?? config.token);
  const jwtPayload = auth.authorization ? decodeJwtPayload(auth.authorization) : {};
  return unique([
    ...listFrom(config.empresaIds ?? config.companyIds),
    auth.empresaId,
    cleanText(config.empresaId),
    cleanText(config.companyId),
    ...(raw.match(/\/empresas\/(\d+)/gi) ?? []).map((match) => match.match(/\d+/)?.[0] ?? ""),
    ...(raw.match(/"empresaId"\s*:\s*"?(\d+)/gi) ?? []).map((match) => match.match(/\d+/)?.[0] ?? ""),
    ...collectIdsFromObject(jwtPayload, [/empresa.*id/i, /company.*id/i, /^emp$/i])
  ]).filter((id) => /^\d+$/.test(id));
}

function hasBuscojobsCredentials(config: Record<string, unknown>) {
  return Boolean(cleanText(config.username ?? config.email ?? config.user) && cleanText(config.password));
}

function hasUsernamePassword(config: Record<string, unknown>) {
  return Boolean(cleanText(config.username ?? config.email ?? config.user) && cleanText(config.password));
}

function prepareConfigForSave(integrationId: string, config?: Record<string, unknown>) {
  if (!config) return null;
  const next = Object.fromEntries(
    Object.entries(config).filter(([, value]) => {
      if (value === null) return true;
      if (typeof value === "string") return value.trim().length > 0;
      return value !== undefined;
    })
  );
  if (integrationId !== "buscojobs") return next;

  const hasCredentials = hasBuscojobsCredentials(next);
  const providedSession = ["apiKey", "token", "accessToken", "sessionCookies", "cookies", "cookie", "browserStorageState"]
    .some((key) => key in next && cleanText(next[key]).length > 0);

  if (hasCredentials && !providedSession) {
    for (const key of ["apiKey", "token", "accessToken", "sessionCookies", "cookies", "cookie", "sessionId", "browserStorageState"]) {
      next[key] = null;
    }
    next.sessionStatus = "credentials_saved";
    next.sessionLastError = null;
    next.lastAgentMessage = "Credenciales guardadas. En la proxima sincronizacion TalentHub intentara iniciar sesion y traer postulantes.";
  }

  return next;
}

function deepFindTextByKey(value: unknown, patterns: RegExp[], depth = 0): string | null {
  if (!value || depth > 6) return null;
  if (typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(row)) {
    if (patterns.some((pattern) => pattern.test(key))) {
      const text = textOrNull(child);
      if (text) return text;
    }
  }
  for (const child of Object.values(row)) {
    const found = deepFindTextByKey(child, patterns, depth + 1);
    if (found) return found;
  }
  return null;
}

async function loginBuscojobsApiWithCredentials(config: Record<string, unknown>) {
  const username = cleanText(config.username ?? config.email ?? config.user);
  const password = cleanText(config.password);
  if (!username || !password) return null;

  const endpoints = unique([
    cleanText(config.apiLoginUrl),
    "https://api.buscojobs.com/v3/uy/api/Account/Login",
    "https://api.buscojobs.com/v3/uy/api/Auth/Login",
    "https://api.buscojobs.com/v3/uy/api/Usuarios/Login",
    "https://api.buscojobs.com/v3/uy/api/Cuentas/Login",
    "https://api.buscojobs.com/v3/uy/api/login",
    "https://www.buscojobs.com.uy/api/login",
    "https://buscojobs.com.uy/api/login"
  ].filter(Boolean));

  const payloads = [
    { email: username, password },
    { username, password },
    { user: username, password },
    { usuario: username, password },
    { mail: username, password },
    { email: username, clave: password },
    { usuario: username, clave: password }
  ];

  for (const endpoint of endpoints) {
    for (const payload of payloads) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            accept: "application/json, text/plain, */*",
            "content-type": "application/json",
            origin: "https://www.buscojobs.com.uy",
            referer: "https://www.buscojobs.com.uy/",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36"
          },
          body: JSON.stringify(payload),
          redirect: "follow"
        });
        const text = await response.text();
        if (!response.ok) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          continue;
        }
        const token = deepFindTextByKey(parsed, [/token/i, /access.?token/i, /^jwt$/i, /^id$/i]);
        if (!token || token.length < 20) continue;
        const empresaId = deepFindTextByKey(parsed, [/empresa.*id/i, /company.*id/i, /^empresaId$/i]);
        const sessionId = deepFindTextByKey(parsed, [/session/i]);
        return {
          apiKey: token.startsWith("Bearer ") ? token : `Bearer ${token}`,
          ...(empresaId ? { empresaId } : {}),
          ...(sessionId ? { sessionId } : {}),
          sessionStatus: "connected",
          sessionRefreshedAt: new Date().toISOString(),
          sessionLastError: null
        };
      } catch {
        continue;
      }
    }
  }

  return null;
}

async function loadPlaywright() {
  const dynamicImport = new Function("name", "return import(name)") as (name: string) => Promise<any>;
  return dynamicImport("playwright");
}

function browserStorageStateFromConfig(config: Record<string, unknown>) {
  const raw = config.browserStorageState;
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

function hasBrowserSessionConfig(config: Record<string, unknown>) {
  return Boolean(
    cleanText(config.browserStorageState)
    || cleanText(config.browserCookies)
    || cookieHeaderFromConfig(config)
  );
}

function cookieDomainFromUrl(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function browserCookiesFromConfig(config: Record<string, unknown>, urlForDomain: string) {
  const raw = cleanText(config.browserCookies ?? config.sessionCookies ?? config.cookies ?? config.cookie);
  const domain = cookieDomainFromUrl(urlForDomain);
  if (!raw || !domain) return [];

  try {
    const parsed = JSON.parse(raw);
    const cookies = Array.isArray(parsed) ? parsed : parsed?.cookies;
    if (Array.isArray(cookies)) {
      return cookies
        .map((cookie) => {
          const name = cleanText(cookie?.name);
          const value = cleanText(cookie?.value);
          if (!name || !value) return null;
          return {
            name,
            value,
            domain: cleanText(cookie?.domain) || domain,
            path: cleanText(cookie?.path) || "/",
            expires: Number.isFinite(Number(cookie?.expires)) ? Number(cookie.expires) : undefined,
            httpOnly: Boolean(cookie?.httpOnly),
            secure: cookie?.secure === undefined ? true : Boolean(cookie.secure),
            sameSite: ["Strict", "Lax", "None"].includes(cleanText(cookie?.sameSite)) ? cleanText(cookie.sameSite) : undefined
          };
        })
        .filter(Boolean);
    }
  } catch {
    // Fall back to raw Cookie header parsing below.
  }

  const header = cookieHeaderFromConfig(config);
  if (!header) return [];
  return header
    .split(";")
    .map((part) => {
      const separator = part.indexOf("=");
      if (separator <= 0) return null;
      const name = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      if (!name || !value) return null;
      return { name, value, domain, path: "/", secure: true };
    })
    .filter(Boolean);
}

async function addConfiguredBrowserCookies(context: any, config: Record<string, unknown>, urlForDomain: string) {
  const cookies = browserCookiesFromConfig(config, urlForDomain);
  if (!cookies.length) return;
  await context.addCookies(cookies);
}

async function fillFirstVisible(page: any, selectors: string[], value: string) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.count() && await locator.isVisible({ timeout: 1500 })) {
        await locator.fill(value);
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

async function clickFirstVisible(page: any, selectors: string[]) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.count() && await locator.isVisible({ timeout: 1500 })) {
        await locator.click();
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

function pageLooksLoggedIn(url: string, text: string) {
  return /\/app\/empresa|panel|ofertas|postulantes|candidatos|curriculum/i.test(`${url} ${text}`)
    && !/iniciar sesion|iniciar sesión|login|captcha|verifica que eres|verifica que sos/i.test(text.slice(0, 4000));
}

function genericPageLooksLoggedIn(text: string) {
  return !/iniciar sesion|iniciar sesión|sign in|log in|login|captcha|verifica que eres|verifica que sos|contrase[nñ]a|password|access denied|forbidden|unauthorized/i.test(text.slice(0, 3000));
}

async function ensureBuscojobsBrowserSession(page: any, config: Record<string, unknown>) {
  const username = cleanText(config.username ?? config.email ?? config.user);
  const password = cleanText(config.password);
  const panelUrl = "https://buscojobs.com.uy/app/empresa/panel";

  await page.goto(panelUrl, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => null);
  await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => null);
  let text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (pageLooksLoggedIn(page.url(), text)) return true;
  if (!username || !password) return false;

  const loginUrls = unique([
    cleanText(config.loginUrl),
    "https://www.buscojobs.com.uy/login",
    "https://www.buscojobs.com.uy/empresas/login",
    "https://www.buscojobs.com.uy/login/empresa",
    "https://www.buscojobs.com.uy/empresa/login",
    "https://www.buscojobs.com.uy/app/login",
    "https://www.buscojobs.com.uy/app/empresa/login",
    "https://www.buscojobs.com.uy/ingresar",
    "https://www.buscojobs.com.uy/iniciar-sesion",
    "https://buscojobs.com.uy/login",
    "https://buscojobs.com.uy/empresas/login",
    "https://buscojobs.com.uy/login/empresa",
    "https://buscojobs.com.uy/empresa/login",
    "https://buscojobs.com.uy/app/login",
    "https://buscojobs.com.uy/app/empresa/login",
    "https://buscojobs.com.uy/ingresar",
    "https://buscojobs.com.uy/iniciar-sesion"
  ].filter(Boolean));

  for (const loginUrl of loginUrls) {
    try {
      await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => null);

      const filledUser = await fillFirstVisible(page, [
        "input[type='email']",
        "input[name*='email' i]",
        "input[name*='mail' i]",
        "input[name*='usuario' i]",
        "input[name*='user' i]",
        "input[name*='login' i]",
        "input[type='text']"
      ], username);
      const filledPassword = await fillFirstVisible(page, [
        "input[type='password']",
        "input[name*='password' i]",
        "input[name*='pass' i]",
        "input[name*='clave' i]",
        "input[name*='contras' i]"
      ], password);
      if (!filledUser || !filledPassword) continue;

      await clickFirstVisible(page, [
        "button[type='submit']",
        "input[type='submit']",
        "button:has-text('Ingresar')",
        "button:has-text('Entrar')",
        "button:has-text('Acceder')",
        "text=Ingresar",
        "text=Entrar"
      ]);
      await page.waitForLoadState("networkidle", { timeout: 18000 }).catch(() => null);
      await page.goto(panelUrl, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => null);
      await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => null);
      text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
      if (pageLooksLoggedIn(page.url(), text)) return true;
      if (/captcha|verifica que eres|verifica que sos|2fa|codigo|código/i.test(text)) return false;
    } catch {
      continue;
    }
  }

  return false;
}

async function ensureGenericBrowserSession(page: any, config: Record<string, unknown>) {
  const baseUrl = cleanText(config.baseUrl ?? config.url);
  const loginUrl = cleanText(config.loginUrl) || baseUrl;
  const username = cleanText(config.username ?? config.email ?? config.user);
  const password = cleanText(config.password);
  if (!baseUrl && !loginUrl) return false;

  await page.goto(baseUrl || loginUrl, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => null);
  await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => null);
  let text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (genericPageLooksLoggedIn(text) && /candidato|postulante|talento|curriculum|cv|perfil|proceso|busqueda|búsqueda/i.test(text)) return true;
  if (!username || !password) return false;

  await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => null);
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => null);
  const filledUser = await fillFirstVisible(page, [
    cleanText(config.usernameSelector),
    "input[type='email']",
    "input[name*='email' i]",
    "input[name*='mail' i]",
    "input[name*='usuario' i]",
    "input[name*='user' i]",
    "input[name*='login' i]",
    "input[type='text']"
  ].filter(Boolean), username);
  const filledPassword = await fillFirstVisible(page, [
    cleanText(config.passwordSelector),
    "input[type='password']",
    "input[name*='password' i]",
    "input[name*='pass' i]",
    "input[name*='clave' i]",
    "input[name*='contras' i]"
  ].filter(Boolean), password);
  if (!filledUser || !filledPassword) return false;
  await clickFirstVisible(page, [
    cleanText(config.submitSelector),
    "button[type='submit']",
    "input[type='submit']",
    "button:has-text('Ingresar')",
    "button:has-text('Entrar')",
    "button:has-text('Acceder')",
    "button:has-text('Login')",
    "text=Ingresar",
    "text=Entrar"
  ].filter(Boolean));
  await page.waitForLoadState("networkidle", { timeout: 18000 }).catch(() => null);
  await page.goto(baseUrl || page.url(), { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => null);
  await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => null);
  text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  return genericPageLooksLoggedIn(text);
}

function apiUrlFromCurl(config: Record<string, unknown>) {
  const raw = cleanText(config.sessionCookies ?? config.cookies ?? config.cookie);
  return raw.match(/curl\s+\^?"([^"]*api\.buscojobs\.com[^"]+)"/i)?.[1]?.replace(/\^/g, "") ?? null;
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function fixMojibake(value: string) {
  const normalizedMarks = value
    .replace(/Ì\u0081/g, "\u0301")
    .replace(/Ì\u0080/g, "\u0300")
    .replace(/Ì\u0083/g, "\u0303")
    .replace(/Ì\u0088/g, "\u0308")
    .replace(/Rodr\uFFFD\s*g/gi, "Rodrig")
    .replace(/\uFFFD\s*/g, "");
  if (!/[ÃÂ]/.test(normalizedMarks)) return normalizedMarks;
  const repaired = Buffer.from(normalizedMarks, "latin1").toString("utf8");
  const originalBadness = (value.match(/[ÃÂ]/g) ?? []).length;
  const repairedBadness = (repaired.match(/[ÃÂ]/g) ?? []).length;
  return repairedBadness < originalBadness ? repaired : normalizedMarks;
}

function dropDanglingNameInitial(value: string) {
  const words = cleanText(value).split(/\s+/).filter(Boolean);
  if (words.length >= 4 && /^[A-ZÁÉÍÓÚÜÑ]$/u.test(words.at(-1) ?? "")) {
    return words.slice(0, -1).join(" ");
  }
  return cleanText(value);
}

function cleanCandidateNameText(value: string) {
  const cleaned = fixMojibake(cleanText(value))
    .normalize("NFC")
    .replace(/^(re|fw|fwd)\s*:\s*/i, "")
    .replace(/^copia\s+de\s+/i, " ")
    .replace(/^cv\s*\.?\s*uy\s+/i, " ")
    .replace(/^uy\s+/i, " ")
    .replace(/^gallito\s+/i, " ")
    .replace(/^c\s*\.?\s*v\s+/i, " ")
    .replace(/\bp\s*d\s*f\b/gi, " ")
    .replace(/\bd\s*o\s*c\s*x?\b/gi, " ")
    .replace(/\b([a-z])\s+(pdf|docx?|rtf|txt)\b/gi, " ")
    .replace(/\.[a-z0-9]{2,6}$/i, "")
    .replace(/[_\-().!¡?¿]+/g, " ")
    .replace(/(^|\s)(cv|curriculum|curriculo|currículum|curiculum|curriculun|curriculm|corriculun|corriculum|vitae|resume|candidato|postulante|pdf|doc|docx|rtf|txt|extracted|extracto|imprimir|compressed|comprimido)(?=\s|$)/gi, " ")
    .replace(/^(aux|auxiliar|enfermer[ií]a|reponedor|vendedor|vendedora|pickers?|administrativ[oa]|operario|operaria|audiovisual|lic|licenciada?|licenciado|sr|sra|dr|dra)\s+/i, " ")
    .replace(/\s+(chofer|cadete|imprimir|foto|photo|imagen|image|y)$/i, " ")
    .replace(/(^|\s)(actual|actualizado|actualizada|final|nuevo|nueva|version|versi[oó]n|v\d+)(?=\s|$)/gi, " ")
    .replace(/\s+(ventas?|marketing|logistica|logística|gastronomia|gastronomía|administraci[oó]n|atenci[oó]n al cliente)$/i, " ")
    .replace(/(^|\s)(19|20)\d{2}(?=\s|$)/g, " ")
    .replace(/\s+\d{1,5}$/g, " ")
    .replace(/^de\s+([A-ZÁÉÍÓÚÜÑ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]{4,80})$/i, "$1")
    .replace(/\b(fecha de nacimiento|nacimiento|domicilio|direcci[oó]n|address|cedula|c[eé]dula|documento|telefono|tel[eé]fono|celular|email|correo|uruguay)\b.*$/i, " ")
    .replace(/\s+/g, " ")
    .trim();
  return dropDanglingNameInitial(cleaned);
}

function cleanDocumentFileName(value: string | null | undefined) {
  const cleaned = fixMojibake(cleanText(value))
    .normalize("NFC")
    .replace(/\bp\s*d\s*f\b/gi, "pdf")
    .replace(/\bd\s*o\s*c\s*x\b/gi, "docx")
    .replace(/\bd\s*o\s*c\b/gi, "doc")
    .replace(/[_ -]*compressed\b/gi, "")
    .replace(/[_ -]+(\.(?:pdf|docx?|rtf|txt))$/i, "$1")
    .replace(/(\.(pdf|docx?|rtf|txt))(?:\.\2)+$/i, "$1")
    .replace(/\s+/g, " ")
    .replace(/\s+\./g, ".")
    .trim();
  return cleaned || null;
}

function normalizeNameCasing(value: string) {
  const cleaned = cleanText(value);
  if (!cleaned || /[A-ZÁÉÍÓÚÜÑ]/u.test(cleaned)) return cleaned;
  const lowerParticles = new Set(["de", "del", "la", "las", "los", "y", "da", "do", "dos"]);
  return cleaned.split(/\s+/).map((word, index) => {
    const lower = word.toLowerCase();
    if (index > 0 && lowerParticles.has(lower)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(" ");
}

function nameFromFileName(fileName: string | null | undefined) {
  const cleaned = normalizeNameCasing(cleanCandidateNameText(cleanText(fileName)));
  if (candidateNameLooksReal(cleaned)) return cleaned;
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 1 && /^[A-ZÁÉÍÓÚÜÑ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ']{2,}$/u.test(words[0])) return words[0];
  if (words.length > 2 && candidateNameLooksReal(words.slice(0, 2).join(" "))) return words.slice(0, 2).join(" ");
  return "";
}

function nameFromEmailAddress(email: string | null | undefined) {
  const localPart = cleanText(email).split("@")[0] ?? "";
  if (!localPart || emailLooksInternalOrSystem(email)) return "";
  const candidate = localPart
    .replace(/\d+/g, " ")
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(/\s+/g, " ")
    .trim();
  return candidateNameLooksReal(candidate) ? candidate : "";
}

function emailLooksInternalOrSystem(value: string | null | undefined) {
  const email = cleanText(value).toLowerCase();
  const localPart = email.split("@")[0] ?? "";
  const domain = email.split("@")[1] ?? "";
  return /^(info|rrhh|recursos|seleccion|selección|admin|contacto|noreply|no-reply|notifications?|support|security|billing)$/i.test(localPart)
    || /seleccion|selección|rrhh|recursos|talento|talent|recruit/i.test(localPart)
    || /^aglh\.com(\.uy)?$/i.test(domain)
    || /google|microsoft|linkedin/i.test(domain);
}

function mailHeaderLooksInternalOrSystem(value: string | null | undefined) {
  const header = cleanText(value).toLowerCase();
  const email = extractEmails(header)[0] ?? "";
  return /no-?reply|noreply|notification|support|security|billing|google|microsoft|linkedin/i.test(header)
    || emailLooksInternalOrSystem(email);
}

function nameFromMailHeader(value: string | null | undefined) {
  if (mailHeaderLooksInternalOrSystem(value)) return "";
  const header = cleanText(value);
  if (!header) return "";
  const displayName = cleanCandidateNameText(header.replace(/<[^>]+>/g, " ").replace(/["']/g, " "));
  if (candidateNameLooksReal(displayName)) return displayName;
  return nameFromEmailAddress(extractEmails(header)[0]);
}

function sentenceFromDocument(content: string, pattern: RegExp) {
  const match = content.match(pattern);
  if (!match) return "";
  const index = Math.max(0, match.index ?? 0);
  const slice = content.slice(Math.max(0, index - 80), index + 220);
  return cleanText(slice.split(/(?<=[.;])\s+/)[0] ?? slice).slice(0, 220);
}

function snippetFromDocument(content: string, pattern: RegExp, limit = 260) {
  const match = content.match(pattern);
  if (!match) return "";
  const index = Math.max(0, match.index ?? 0);
  const slice = content.slice(index, index + limit);
  return cleanText(slice.split(/(?<=[.;])\s+/)[0] ?? slice)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, " ")
    .replace(/(?:\+?\d{1,3}[\s.-]?)?(?:0?9\d|2\d|4\d|[1-9]\d{1,3})[\s.-]?\d{3}[\s.-]?\d{3,4}/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, limit);
}

function detectedLanguages(content: string) {
  const languages = [];
  if (/ingl[eé]s|english/i.test(content)) languages.push("ingles");
  if (/portugu[eé]s|portuguese/i.test(content)) languages.push("portugues");
  if (/franc[eé]s|french/i.test(content)) languages.push("frances");
  return languages;
}

function detectedRoleTags(content: string) {
  const roles = [
    ["abogado", /abogad[oa]|derecho|jur[ií]dic[oa]|legal/i],
    ["ventas", /ventas|vendedor|vendedora|comercial/i],
    ["gastronomia", /gastronom[ií]a|restaurante|mozo|moza|cocina|cocinero|cocinera|barista|cafeter[ií]a/i],
    ["administracion", /administraci[oó]n|administrativ[oa]/i],
    ["atencion al cliente", /atenci[oó]n al cliente|customer service/i],
    ["logistica", /log[ií]stica|dep[oó]sito|warehouse/i],
    ["contabilidad", /contabilidad|contador|contadora|liquidaci[oó]n/i],
    ["recursos humanos", /recursos humanos|selecci[oó]n|reclutamiento/i],
    ["chofer", /chofer|cadete|reparto|conductor|conductora|delivery/i],
    ["tecnico", /t[eé]cnic[oa]|mantenimiento/i]
  ] as const;
  return roles.filter(([, pattern]) => pattern.test(content)).map(([tag]) => tag);
}

function detectedExperienceYears(content: string) {
  const direct = content.match(/(?:experiencia|trayectoria|trabaj[oaé]|laboral|profesional)[^.;]{0,80}?(\d{1,2})\s*(?:a[nñ]os|years)/i)
    ?? content.match(/(?:m[aá]s de|mas de|over)\s*(\d{1,2})\s*(?:a[nñ]os|years)[^.;]{0,80}?(?:experiencia|trayectoria|trabaj[oaé]|laboral|profesional)/i);
  const years = Number(direct?.[1] ?? 0);
  return years > 0 && years < 60 ? years : null;
}

function detectedProfileLabel(content: string, fallbackRole: string) {
  const roles = detectedRoleTags(content);
  if (roles.length) return roles[0];
  const normalizedRole = cleanText(fallbackRole);
  if (normalizedRole && normalizedRole !== "Candidato importado") return normalizedRole;
  return "";
}

function documentSummary(content: string, fallbackRole: string) {
  const mainContent = textWithoutReferenceSections(content);
  const profile = detectedProfileLabel(mainContent, fallbackRole);
  const years = detectedExperienceYears(mainContent);
  const experience = snippetFromDocument(mainContent, /(?:experiencia|experiencia laboral|trayectoria|antecedentes laborales|trabaj[eéoa]|desempe[nñ]|responsable|cargo|puesto|funciones|tareas)/i);
  const education = snippetFromDocument(mainContent, /(?:formaci[oó]n|educaci[oó]n|estudios|universidad|facultad|bachiller|tecnicatura|licenciatura|posgrado|curso)/i);
  const languages = detectedLanguages(mainContent);
  const location = sentenceFromDocument(mainContent, /montevideo|canelones|maldonado|san jose|colonia|florida|rocha|paysandu|salto|rivera|tacuarembo|durazno|soriano|lavalleja|artigas|cerro largo|flores|rio negro|treinta y tres/i);
  const facts = [
    profile ? `Perfil detectado: ${profile}.` : "",
    years ? `Experiencia declarada: ${years} anos.` : "",
    experience ? `Experiencia: ${experience}` : "",
    education ? `Formacion: ${education}` : "",
    languages.length ? `Idiomas: ${languages.join(", ")}.` : "",
    location ? `Ubicacion detectada: ${location}` : ""
  ].filter(Boolean);
  if (facts.length) return unique(facts).slice(0, 6).join("\n");
  return "CV importado. Faltan datos legibles para resumir.";
}

export function candidateFromFreeText(sourceType: string, text: string, options: { sourceId?: string | null; sourceUrl?: string | null; currentRole?: string | null; fileName?: string | null; fallbackName?: string | null; sender?: string | null; contactText?: string | null } = {}): CandidateImport | null {
  const rawContent = fixMojibake(normalizeWhitespace(text));
  const sanitizedContent = cleanDocumentTextForImport(rawContent);
  const content = sanitizedContent || normalizeWhitespace(options.fileName ?? "");
  if (!content || content.length < 8) return null;
  const contactText = normalizeWhitespace(options.contactText ?? content);
  const senderContact = mailHeaderLooksInternalOrSystem(options.sender) ? "" : cleanText(options.sender);
  const email = unique([...extractEmails(contactText), ...extractEmails(senderContact)])
    .map((item) => item.toLowerCase())
    .filter((item) => !emailLooksInternalOrSystem(item));
  const phone = extractPhones(contactText);
  const explicitName = cleanCandidateNameText(content.match(/(?:nombre|name|candidato|postulante)\s*[:\-]\s*([A-ZÁÉÍÓÚÜÑ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]{4,80})/i)?.[1] ?? "");
  const fallbackName = nameFromFileName(options.fallbackName ?? options.fileName);
  const senderName = nameFromMailHeader(options.sender);
  const firstLikelyName = content
    .split(/[|•\n\r,]/)
    .map((part) => cleanCandidateNameText(normalizeWhitespace(part)))
    .find((part) => candidateNameLooksReal(part) && part.toLowerCase() !== fallbackName.toLowerCase());
  const fromEmailName = nameFromEmailAddress(email[0]);
  const realName = fallbackName || explicitName || senderName || firstLikelyName || fromEmailName;
  const fullName = realName || email[0] || phone[0];
  if (!fullName) return null;
  if (sourceType === "gmail" && /google cloud team|google workspace team|google team|microsoft account team|linkedin notifications/i.test(fullName)) return null;
  if ((sourceType === "gmail" || sourceType === "drive") && !candidateNameLooksReal(realName)) return null;

  const analysis = analyzeCvText(content);
  const roleFromText = analysis.roles[0] ?? content.match(/(?:cargo|puesto|rol|postulaci[oó]n)\s*[:\-]\s*([^.;\n\r]{3,70})/i)?.[1];
  const fallbackRole = sourceType === "gmail" || sourceType === "drive" ? null : options.currentRole;
  const role = compactLabel(roleFromText ?? fallbackRole, "Candidato importado");
  const languageTags = analysis.languages.map((language) => language.lang);
  const roleTags = analysis.roles;
  const years = analysis.years;
  const qualityScore = Math.min(100,
    20
    + (email.length ? 15 : 0)
    + (phone.length ? 15 : 0)
    + (analysis.hasReadableText ? 15 : 0)
    + (roleTags.length ? 15 : 0)
    + (analysis.experienceHighlights.length ? 10 : 0)
    + (analysis.educationHighlights.length ? 5 : 0)
    + (analysis.languages.length ? 5 : 0)
  );
  return {
    fullName,
    email,
    phone,
    city: analysis.city,
    country: analysis.country,
    currentRole: role,
    years,
    tags: safeTags([role, ...roleTags, ...analysis.skills, ...languageTags], sourceType),
    languages: analysis.languages,
    summary: analysis.summary,
    qualityScore,
    sourceId: options.sourceId ?? `${sourceType}:${email[0] ?? phone[0] ?? fullName}`,
    sourceUrl: options.sourceUrl ?? null,
    documents: [{
      type: "cv",
      fileName: cleanDocumentFileName(options.fileName) || `${fullName} - ${sourceType}`,
      fileUrl: options.sourceUrl ?? null,
      rawText: content,
      sourceId: options.sourceId ?? null,
      sourcePath: options.sourceUrl ?? null,
      isPrimaryCv: true
    }],
    raw: { text: content, sourceUrl: options.sourceUrl, fileName: options.fileName }
  };
}

async function googleAccessToken(config: Record<string, unknown>) {
  const refreshToken = cleanText(config.refreshToken);
  const clientId = cleanText(config.clientId);
  const clientSecret = cleanText(config.clientSecret);
  const direct = cleanText(config.accessToken ?? config.token ?? config.apiKey).replace(/^Bearer\s+/i, "");
  if (!refreshToken || !clientId || !clientSecret) {
    return direct ? { token: direct, configUpdate: {} } : null;
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(`Google OAuth no pudo renovar token: ${JSON.stringify(payload).slice(0, 180)}`);
  }
  return {
    token: String(payload.access_token),
    configUpdate: {
      accessToken: payload.access_token,
      oauthStatus: "connected",
      sessionRefreshedAt: new Date().toISOString(),
      sessionLastError: null
    }
  };
}

function googleOAuthScopes(sourceType: "gmail" | "drive") {
  return sourceType === "gmail"
    ? ["https://www.googleapis.com/auth/gmail.readonly"]
    : ["https://www.googleapis.com/auth/drive.readonly"];
}

function googleRedirectUri(config: Record<string, unknown>) {
  return cleanText(config.redirectUri) || `${appConfig.corsOrigin.replace(/\/$/, "")}/api/integrations/google/callback`;
}

function googleOAuthUrl(sourceType: "gmail" | "drive", config: Record<string, unknown>) {
  const clientId = cleanText(config.clientId);
  if (!clientId) throw new Error("Falta Client ID de Google.");
  const expectedEmail = expectedGoogleEmail(config);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleRedirectUri(config),
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    state: sourceType,
    scope: googleOAuthScopes(sourceType).join(" ")
  });
  if (expectedEmail) params.set("login_hint", expectedEmail);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function expectedGoogleEmail(config: Record<string, unknown>) {
  return cleanText(config.expectedGoogleEmail ?? config.googleEmail ?? config.expectedEmail).toLowerCase();
}

async function googleConnectedEmail(sourceType: "gmail" | "drive", token: string) {
  if (sourceType === "gmail") {
    const profile = await googleJson("https://gmail.googleapis.com/gmail/v1/users/me/profile", token);
    return cleanText(profile.emailAddress).toLowerCase();
  }
  const about = await googleJson("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)", token);
  return cleanText(about?.user?.emailAddress).toLowerCase();
}

export function gmailHistoryMessageIds(payload: any) {
  const ids: string[] = [];
  for (const entry of Array.isArray(payload?.history) ? payload.history : []) {
    for (const added of Array.isArray(entry?.messagesAdded) ? entry.messagesAdded : []) {
      const id = cleanText(added?.message?.id);
      if (id) ids.push(id);
    }
  }
  return unique(ids);
}

async function gmailProfile(token: string) {
  const profile = await googleJson("https://gmail.googleapis.com/gmail/v1/users/me/profile", token);
  return {
    emailAddress: cleanText(profile.emailAddress).toLowerCase(),
    historyId: cleanText(profile.historyId)
  };
}

async function googleAccountConfigUpdate(sourceType: "gmail" | "drive", token: string, config: Record<string, unknown>) {
  const connectedGoogleEmail = await googleConnectedEmail(sourceType, token);
  const expected = expectedGoogleEmail(config);
  const update: Record<string, unknown> = { connectedGoogleEmail };
  if (expected) update.expectedGoogleEmail = expected;
  if (expected && connectedGoogleEmail && connectedGoogleEmail !== expected) {
    throw new Error(`${sourceType === "gmail" ? "Gmail" : "Google Drive"} quedo conectado con ${connectedGoogleEmail}, pero TalentHub espera ${expected}. Volve a Conectar Google eligiendo la cuenta correcta.`);
  }
  return update;
}

async function exchangeGoogleOAuthCode(sourceType: "gmail" | "drive", config: Record<string, unknown>, code: string) {
  const clientId = cleanText(config.clientId);
  const clientSecret = cleanText(config.clientSecret);
  if (!clientId || !clientSecret) throw new Error("Faltan Client ID y Client secret de Google.");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: googleRedirectUri(config),
      grant_type: "authorization_code"
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(`Google no devolvio tokens validos: ${JSON.stringify(payload).slice(0, 180)}`);
  }
  if (!payload.refresh_token && !cleanText(config.refreshToken)) {
    throw new Error("Google conecto, pero no devolvio refresh token. Usa el link nuevo con permiso completo/consentimiento.");
  }
  const accountUpdate = await googleAccountConfigUpdate(sourceType, String(payload.access_token), config);
  return {
    clientId,
    clientSecret,
    refreshToken: payload.refresh_token ?? cleanText(config.refreshToken),
    accessToken: payload.access_token,
    oauthStatus: "connected",
    sessionStatus: "connected",
    sessionRefreshedAt: new Date().toISOString(),
    sessionLastError: null,
    ...accountUpdate,
    lastAgentMessage: `${sourceType === "gmail" ? "Gmail" : "Google Drive"} conectado con OAuth${accountUpdate.connectedGoogleEmail ? ` como ${accountUpdate.connectedGoogleEmail}` : ""}.`
  };
}

async function googleJson(url: string, token: string) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Google API respondio ${response.status}: ${JSON.stringify(payload).slice(0, 180)}`);
  return payload;
}

function googleWebFallback(sourceType: "gmail" | "drive", displayName: string, config: Record<string, unknown>) {
  const defaultSearchUrl = sourceType === "gmail"
    ? "https://mail.google.com/mail/u/0/#search/cv%20OR%20curriculum%20OR%20resume%20OR%20candidato%20OR%20postulante%20OR%20linkedin"
    : "https://drive.google.com/drive/search?q=cv%20OR%20curriculum%20OR%20resume%20OR%20candidato%20OR%20postulante";
  const defaultPattern = sourceType === "gmail"
    ? "mail|inbox|all|search|cv|curriculum|resume|candidato|postulante|linkedin"
    : "document|file|drive|cv|curriculum|resume|candidato|postulante";
  const searchUrl = cleanText(config.baseUrl) || defaultSearchUrl;
  return scrapeGenericWebSource(sourceType, displayName, {
    ...config,
    baseUrl: searchUrl,
    searchUrls: cleanText(config.searchUrls) || searchUrl,
    candidateLinkPattern: cleanText(config.candidateLinkPattern) || defaultPattern
  });
}

function gmailMessageText(message: any) {
  const headers = Object.fromEntries((message.payload?.headers ?? []).map((header: any) => [String(header.name).toLowerCase(), String(header.value ?? "")]));
  const parts: any[] = [];
  const walk = (part: any) => {
    if (!part) return;
    parts.push(part);
    for (const child of part.parts ?? []) walk(child);
  };
  walk(message.payload);
  const bodyText = parts
    .filter((part) => /text\/plain|text\/html/i.test(part.mimeType ?? "") && part.body?.data)
    .map((part) => decodeBase64Url(String(part.body.data)))
    .join("\n");
  const attachmentNames = parts.map((part) => cleanText(part.filename)).filter(Boolean).join(" ");
  return {
    from: headers.from ?? "",
    subject: headers.subject ?? "",
    bodyText: htmlText(bodyText),
    attachmentNames,
    text: htmlText(`${headers.from ?? ""}\n${headers.subject ?? ""}\n${attachmentNames}\n${bodyText}`),
    parts
  };
}

function gmailLooksLikeSystemSender(from: string) {
  return /google cloud|google workspace|google payments|microsoft|linkedin notifications?|no-?reply|noreply|support|notifications?|security|alert|billing|facturacion|calendar|meet/i.test(from);
}

function gmailHasCandidateIntent(text: string) {
  return /\b(cv|curriculum|currículo|resume|postulante|postulación|postulacion|candidato|búsqueda laboral|busqueda laboral|entrevista|selección|seleccion|linkedin\.com\/in|adjunto|postularme|me postulo|mi experiencia)\b/i.test(text);
}

function gmailHasCandidateProfileSignal(text: string) {
  return /\b(experiencia|educaci[oó]n|formaci[oó]n|habilidades|competencias|referencias|objetivo laboral|perfil profesional|datos personales|c[eé]dula|tel[eé]fono|celular|linkedin\.com\/in|mail|email|correo)\b/i.test(text);
}

function gmailLooksLikeSystemMessage(parsed: ReturnType<typeof gmailMessageText>) {
  const text = `${parsed.from}\n${parsed.subject}\n${parsed.bodyText}`;
  return gmailLooksLikeSystemSender(parsed.from)
    || /google cloud|google workspace|security alert|work account access|request for work account|billing|facturaci[oó]n|password reset|verification code/i.test(text);
}

function decodeGmailAttachmentData(value: string) {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function xmlText(value: string) {
  return decodeHtml(value
    .replace(/<w:tab\s*\/>/gi, " ")
    .replace(/<\/w:p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
  );
}

function extractDocxText(buffer: Buffer) {
  const chunks: string[] = [];
  let offset = 0;
  while (offset < buffer.length - 46) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      offset += 1;
      continue;
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.slice(offset + 46, offset + 46 + fileNameLength).toString("utf8");
    offset += 46 + fileNameLength + extraLength + commentLength;
    if (!/^word\/(document|header\d*|footer\d*)\.xml$/i.test(fileName)) continue;
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) continue;
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.slice(dataStart, dataStart + compressedSize);
    const content = method === 8 ? inflateRawSync(compressed) : compressed;
    chunks.push(xmlText(content.toString("utf8")));
  }
  return chunks.join("\n").slice(0, 30000);
}

function extractPdfText(buffer: Buffer) {
  const raw = buffer.toString("latin1");
  const literals = [...raw.matchAll(/\(([^()]{2,300})\)\s*T[jJ]/g)].map((match) => match[1]);
  const readable = raw
    .replace(/\\[nrtbf()\\]/g, " ")
    .match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9@._%+\-\s]{4,}/g)
    ?.join(" ") ?? "";
  return decodeHtml([...literals, readable].join(" ").replace(/\\([()\\])/g, "$1").replace(/\s+/g, " ")).slice(0, 30000);
}

async function extractPdfTextAccurate(buffer: Buffer) {
  let parser: PDFParse | null = null;
  try {
    parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    return cleanDocumentTextForImport(result.text ?? "").slice(0, 30000);
  } catch {
    return "";
  } finally {
    await parser?.destroy().catch(() => undefined);
  }
}

function cleanDocumentTextForImport(value: string) {
  const text = normalizeWhitespace(value);
  if (!text) return "";
  const lower = text.toLowerCase();
  const binaryPdfSignals = (lower.match(/%pdf-|endobj|xref|startxref|\/flatedecode|\/xobject|\/font|\/colorspace/g) ?? []).length;
  if (binaryPdfSignals >= 3) return "";
  if (/^%pdf-/.test(lower)) return "";
  const alpha = (text.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) ?? []).length;
  const odd = (text.match(/[^\sA-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9@._%+\-:,;()/]/g) ?? []).length;
  if (text.length > 200 && odd > alpha * 0.35) return "";
  return text;
}

async function attachmentText(fileName: string, mimeType: string, buffer: Buffer) {
  const lowerName = fileName.toLowerCase();
  const lowerMime = mimeType.toLowerCase();
  if (lowerMime.startsWith("text/")) return cleanDocumentTextForImport(buffer.toString("utf8").slice(0, 30000));
  if (lowerName.endsWith(".docx") || lowerMime.includes("wordprocessingml")) return cleanDocumentTextForImport(extractDocxText(buffer));
  if (lowerName.endsWith(".pdf") || lowerMime.includes("pdf")) {
    const accurate = await extractPdfTextAccurate(buffer);
    return accurate || cleanDocumentTextForImport(extractPdfText(buffer));
  }
  return "";
}

function looksLikeCvAttachment(fileName: string, mimeType: string) {
  return /\.(pdf|docx?|rtf|txt)$/i.test(fileName)
    || /pdf|word|officedocument|rtf|text/i.test(mimeType)
    || /\b(cv|curriculum|resume|candidato|postulante)\b/i.test(fileName);
}

function gmailAttachmentLooksCandidate(attachment: { fileName: string; rawText?: string }) {
  const text = `${attachment.fileName}\n${attachment.rawText ?? ""}`;
  const hasNameInFile = Boolean(nameFromFileName(attachment.fileName));
  const hasContact = extractEmails(text).length > 0 || extractPhones(text).length > 0;
  const hasCandidateWord = /\b(cv|curriculum|currículo|resume|candidato|postulante)\b/i.test(attachment.fileName);
  if (hasNameInFile && (hasCandidateWord || hasContact || gmailHasCandidateProfileSignal(text))) return true;
  if (hasContact && (gmailHasCandidateIntent(text) || gmailHasCandidateProfileSignal(text))) return true;
  return false;
}

function gmailShouldImport(parsed: ReturnType<typeof gmailMessageText>, attachments: { fileName: string; rawText?: string }[]) {
  const candidateAttachment = attachments.some(gmailAttachmentLooksCandidate);
  if (gmailLooksLikeSystemMessage(parsed) && !candidateAttachment) return false;
  return candidateAttachment;
}

function decodeMimeWords(value: string) {
  return value.replace(/=\?([^?]+)\?([bq])\?([^?]+)\?=/gi, (_match, _charset, encoding, text) => {
    try {
      if (String(encoding).toLowerCase() === "b") return Buffer.from(text, "base64").toString("utf8");
      return String(text).replace(/_/g, " ").replace(/=([A-F0-9]{2})/gi, (_hexMatch, hex) => String.fromCharCode(parseInt(hex, 16)));
    } catch {
      return text;
    }
  });
}

function parseMimeHeaderBlock(block: string) {
  const headers: Record<string, string> = {};
  let current = "";
  for (const rawLine of block.split(/\r?\n/)) {
    if (/^\s/.test(rawLine) && current) {
      headers[current] = `${headers[current]} ${rawLine.trim()}`;
      continue;
    }
    const index = rawLine.indexOf(":");
    if (index < 0) continue;
    current = rawLine.slice(0, index).toLowerCase();
    headers[current] = decodeMimeWords(rawLine.slice(index + 1).trim());
  }
  return headers;
}

function splitMimeMessage(raw: string) {
  const index = raw.search(/\r?\n\r?\n/);
  if (index < 0) return { headers: {}, body: raw };
  const separator = raw.match(/\r?\n\r?\n/)?.[0] ?? "\n\n";
  return {
    headers: parseMimeHeaderBlock(raw.slice(0, index)),
    body: raw.slice(index + separator.length)
  };
}

function mimeParam(header: string | undefined, name: string) {
  const text = header ?? "";
  const encoded = text.match(new RegExp(`${name}\\*\\s*=\\s*([^;]+)`, "i"))?.[1];
  if (encoded) {
    const cleaned = encoded.trim().replace(/^"|"$/g, "");
    const encodedPart = cleaned.includes("''") ? cleaned.split("''").slice(1).join("''") : cleaned;
    try {
      return decodeURIComponent(encodedPart);
    } catch {
      return encodedPart;
    }
  }
  return decodeMimeWords(text.match(new RegExp(`${name}\\s*=\\s*"?([^";]+)"?`, "i"))?.[1] ?? "");
}

function decodeQuotedPrintable(value: string) {
  return value
    .replace(/=\r?\n/g, "")
    .replace(/=([A-F0-9]{2})/gi, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function decodeMimeBody(body: string, transferEncoding: string) {
  const encoding = transferEncoding.toLowerCase();
  if (encoding.includes("base64")) return Buffer.from(body.replace(/\s+/g, ""), "base64");
  if (encoding.includes("quoted-printable")) return Buffer.from(decodeQuotedPrintable(body), "utf8");
  return Buffer.from(body, "utf8");
}

async function collectMimeAttachments(raw: string): Promise<Array<{ fileName: string; mimeType: string; rawText: string; bodyText: string; fileDataBase64?: string | null; sizeBytes?: number | null; fileHash?: string | null }>> {
  const attachments: Array<{ fileName: string; mimeType: string; rawText: string; bodyText: string; fileDataBase64?: string | null; sizeBytes?: number | null; fileHash?: string | null }> = [];
  async function visit(partRaw: string): Promise<void> {
    const { headers, body } = splitMimeMessage(partRaw);
    const contentType = headers["content-type"] ?? "text/plain";
    const disposition = headers["content-disposition"] ?? "";
    const boundary = mimeParam(contentType, "boundary");
    if (boundary) {
      const boundaryText = `--${boundary}`;
      for (const part of body.split(boundaryText).slice(1)) {
        if (part.startsWith("--")) break;
        await visit(part.replace(/^\r?\n/, "").replace(/\r?\n$/, ""));
      }
      return;
    }
    const fileName = cleanText(mimeParam(disposition, "filename") || mimeParam(contentType, "name"));
    const mimeType = cleanText(contentType.split(";")[0]) || "application/octet-stream";
    const decoded = decodeMimeBody(body, headers["content-transfer-encoding"] ?? "");
    const bodyText = mimeType.startsWith("text/") ? cleanDocumentTextForImport(decoded.toString("utf8").slice(0, 30000)) : "";
    if (!fileName || !looksLikeCvAttachment(fileName, mimeType)) {
      if (bodyText) attachments.push({ fileName: "", mimeType, rawText: "", bodyText });
      return;
    }
    const shouldStoreFile = decoded.byteLength > 0 && decoded.byteLength <= MAX_STORED_CV_BYTES;
    attachments.push({
      fileName,
      mimeType,
      rawText: await attachmentText(fileName, mimeType, decoded) || fileName,
      bodyText,
      fileDataBase64: shouldStoreFile ? decoded.toString("base64") : null,
      sizeBytes: decoded.byteLength,
      fileHash: createHash("sha256").update(decoded).digest("hex")
    });
  }
  await visit(raw);
  return attachments;
}

function splitMboxMessages(buffer: Buffer) {
  const text = buffer.toString("latin1");
  return text.split(/\n(?=From [^\n]+\n)/g).map((message) => message.replace(/^From [^\n]+\n/, "")).filter((message) => message.trim().length > 0);
}

export async function candidatesFromGmailMbox(buffer: Buffer, fileName = "gmail-takeout.mbox") {
  const rows: CandidateImport[] = [];
  let messages = 0;
  let reviewedAttachments = 0;
  let candidateAttachments = 0;
  let skipped = 0;
  for (const rawMessage of splitMboxMessages(buffer)) {
    messages += 1;
    const parsed = await candidatesFromGmailRawMessage(rawMessage, fileName, messages);
    rows.push(...parsed.rows);
    reviewedAttachments += parsed.stats.reviewedAttachments;
    candidateAttachments += parsed.stats.candidateAttachments;
    skipped += parsed.stats.skipped;
  }
  return {
    rows,
    stats: { messages, reviewedAttachments, candidateAttachments, skipped }
  };
}

export async function candidatesFromGmailRawMessage(rawMessage: string | Buffer, fileName = "gmail-takeout.mbox", messageNumber = 1) {
  const raw = Buffer.isBuffer(rawMessage) ? rawMessage.toString("latin1") : rawMessage;
  const rows: CandidateImport[] = [];
  let reviewedAttachments = 0;
  let candidateAttachments = 0;
  let skipped = 0;
  const { headers, body } = splitMimeMessage(raw.replace(/^From [^\n]+\n/, ""));
  const sender = headers.from ?? "";
  const subject = headers.subject ?? "";
  const date = headers.date ?? "";
  const parts = await collectMimeAttachments(`${Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join("\n")}\n\n${body}`);
  const bodyText = parts.map((part) => part.bodyText).filter(Boolean).join("\n").slice(0, 5000);
  const attachments = parts.filter((part) => part.fileName);
  reviewedAttachments += attachments.length;
  const attachmentsToImport = attachments.filter(gmailAttachmentLooksCandidate);
  candidateAttachments += attachmentsToImport.length;
  for (const [index, attachment] of attachmentsToImport.entries()) {
    const documentText = `${attachment.fileName}\n${attachment.rawText}`.trim();
    const contactText = `${documentText}\n${sender}\n${bodyText}`.slice(0, 5000);
    const candidate = candidateFromFreeText("gmail", documentText, {
      sourceId: `gmail-takeout:${fileName}:${messageNumber}:${index}:${attachment.fileName}`,
      sourceUrl: null,
      currentRole: subject,
      fileName: attachment.fileName,
      fallbackName: attachment.fileName,
      sender,
      contactText
    });
    if (!candidate) {
      skipped += 1;
      continue;
    }
    candidate.documents = [{
      type: "cv",
      fileName: attachment.fileName,
      rawText: cleanDocumentTextForImport(attachment.rawText),
      mimeType: attachment.mimeType,
      fileDataBase64: attachment.fileDataBase64,
      sizeBytes: attachment.sizeBytes,
      fileHash: attachment.fileHash,
      sourceId: candidate.sourceId,
      sourcePath: `Google Takeout: ${fileName}${date ? ` - ${date}` : ""}`,
      isPrimaryCv: true
    }];
    candidate.raw = { source: "gmail-takeout", fileName, subject, from: sender, date };
    rows.push(candidate);
  }
  return {
    rows,
    stats: { messages: 1, reviewedAttachments, candidateAttachments, skipped }
  };
}

function zipEntries(buffer: Buffer): Array<{ name: string; content: Buffer }> {
  const entries: Array<{ name: string; content: Buffer }> = [];
  let offset = 0;
  while (offset < buffer.length - 46) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      offset += 1;
      continue;
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.slice(offset + 46, offset + 46 + fileNameLength).toString("utf8");
    offset += 46 + fileNameLength + extraLength + commentLength;
    if (!/\.mbox$/i.test(fileName)) continue;
    if (localOffset < 0 || localOffset > buffer.length - 30) continue;
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) continue;
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart < 0 || dataStart + compressedSize > buffer.length) continue;
    const compressed = buffer.slice(dataStart, dataStart + compressedSize);
    if (method === 0) entries.push({ name: fileName, content: compressed });
    if (method === 8) entries.push({ name: fileName, content: inflateRawSync(compressed) });
  }
  return entries;
}

export async function candidatesFromGmailTakeoutArchive(buffer: Buffer, fileName = "gmail-takeout.mbox") {
  const lowerName = fileName.toLowerCase();
  const isZip = lowerName.endsWith(".zip") || buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  if (!isZip) return candidatesFromGmailMbox(buffer, fileName);

  const archives = zipEntries(buffer);
  const rows: CandidateImport[] = [];
  const stats = { messages: 0, reviewedAttachments: 0, candidateAttachments: 0, skipped: 0, mboxFiles: archives.length };
  for (const entry of archives) {
    const parsed = await candidatesFromGmailMbox(entry.content, `${fileName}/${entry.name}`);
    rows.push(...parsed.rows);
    stats.messages += parsed.stats.messages;
    stats.reviewedAttachments += parsed.stats.reviewedAttachments;
    stats.candidateAttachments += parsed.stats.candidateAttachments;
    stats.skipped += parsed.stats.skipped;
  }
  if (archives.length === 0) stats.skipped += 1;
  return { rows, stats };
}

async function gmailAttachments(messageId: string, parts: any[], token: string, deadlineMs = Date.now() + 45_000) {
  const attachments = [];
  for (const part of parts) {
    if (Date.now() > deadlineMs) break;
    const fileName = cleanText(part.filename);
    const attachmentId = cleanText(part.body?.attachmentId);
    const mimeType = cleanText(part.mimeType);
    if (!fileName || !looksLikeCvAttachment(fileName, mimeType)) continue;
    const size = Number(part.body?.size ?? 0);
    if (Number.isFinite(size) && size > MAX_STORED_CV_BYTES) {
      attachments.push({
        fileName,
        mimeType,
        rawText: fileName,
        sourceId: `gmail:${messageId}:${attachmentId || fileName}`,
        sourcePath: `https://mail.google.com/mail/u/0/#all/${messageId}`,
        isPrimaryCv: true,
        skippedReason: "archivo grande"
      });
      continue;
    }
    try {
      const body = attachmentId
        ? await googleJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`, token)
        : part.body?.data ? { data: part.body.data } : null;
      if (!body?.data) continue;
      const buffer = decodeGmailAttachmentData(String(body.data));
      const rawText = await attachmentText(fileName, mimeType, buffer);
      const shouldStoreFile = buffer.byteLength > 0 && buffer.byteLength <= MAX_STORED_CV_BYTES;
      attachments.push({
        fileName,
        mimeType,
        rawText,
        fileDataBase64: shouldStoreFile ? buffer.toString("base64") : null,
        sizeBytes: buffer.byteLength,
        fileHash: createHash("sha256").update(buffer).digest("hex"),
        sourceId: `gmail:${messageId}:${attachmentId || fileName}`,
        sourcePath: `https://mail.google.com/mail/u/0/#all/${messageId}`,
        isPrimaryCv: true
      });
    } catch {
      attachments.push({
        fileName,
        mimeType,
        rawText: fileName,
        sourceId: `gmail:${messageId}:${attachmentId || fileName}`,
        sourcePath: `https://mail.google.com/mail/u/0/#all/${messageId}`,
        isPrimaryCv: true
      });
    }
  }
  return attachments;
}

async function scrapeGmail(config: Record<string, unknown>): Promise<AgentSyncResult> {
  let auth: Awaited<ReturnType<typeof googleAccessToken>> = null;
  try {
    auth = await googleAccessToken(config);
  } catch (error: any) {
    return {
      rows: [],
      configUpdate: {
        sessionStatus: "requires_oauth",
        sessionLastError: `Gmail OAuth no funciono: ${cleanText(error?.message).slice(0, 180)}`
      },
      message: `Gmail OAuth no funciono: ${cleanText(error?.message).slice(0, 180)}`
    };
  }
  if (!auth) {
    return {
      rows: [],
      configUpdate: {
        sessionStatus: "requires_oauth",
        sessionLastError: "Gmail necesita OAuth completo de Google: Client ID, Client secret y refresh token."
      },
      message: "Gmail no tiene OAuth completo. Conecta Google antes de sincronizar correos."
    };
  }
  try {
    auth.configUpdate = { ...auth.configUpdate, ...(await googleAccountConfigUpdate("gmail", auth.token, config)) };
  } catch (error: any) {
    const message = cleanText(error?.message).slice(0, 240);
    return {
      rows: [],
      configUpdate: {
        ...auth.configUpdate,
        sessionStatus: "requires_oauth",
        sessionLastError: message,
        oauthStatus: "wrong_account"
      },
      message
    };
  }
  try {
    const startedAt = Date.now();
    const deadlineMs = startedAt + numberFromConfig(config.gmailBudgetMs, 45_000);
    const maxResults = Math.min(numberFromConfig(config.maxResults, 500), 500);
    const maxMessages = Math.min(numberFromConfig(config.maxMessages, 120), 120);
    const storedQuery = cleanText(config.gmailQuery);
    const storedPendingIds = Array.isArray(config.gmailPendingMessageIds)
      ? (config.gmailPendingMessageIds as unknown[]).map(cleanText).filter(Boolean)
      : [];
    const storedNextPageToken = cleanText(config.gmailNextPageToken);
    const storedHistoryId = cleanText(config.gmailHistoryId);
    const storedHistoryStartId = cleanText(config.gmailHistoryStartId);
    const storedHistoryTargetId = cleanText(config.gmailHistoryTargetId);
    const storedHistoryPageToken = cleanText(config.gmailHistoryNextPageToken);
    const canUseHistory = Boolean(
      cleanText(config.gmailBackfillCompleteAt)
      && !cleanText(config.query)
      && (storedHistoryId || storedHistoryStartId)
    );
    const historyMode = canUseHistory && (storedPendingIds.length > 0 || storedHistoryId || storedHistoryStartId);
    const syncQuery = historyMode
      ? { query: "", mode: "history", since: storedHistoryStartId || storedHistoryId }
      : gmailSyncQueryForConfig(config, storedPendingIds.length > 0 || Boolean(storedNextPageToken));
    let historySeedId = cleanText(config.gmailHistorySeedId);
    if (!historyMode && syncQuery.mode !== "custom" && !historySeedId) {
      historySeedId = (await gmailProfile(auth.token)).historyId;
    }
    const query = syncQuery.query;
    const resetStoredQueue = !historyMode && Boolean(storedQuery && storedQuery !== query);
    const pendingIds = resetStoredQueue ? [] : storedPendingIds;
    let nextPageToken = resetStoredQueue ? "" : storedNextPageToken;
    let historyStartId = storedHistoryStartId || storedHistoryId;
    let historyTargetId = storedHistoryTargetId;
    let historyNextPageToken = storedHistoryPageToken;
    let fetchedPage = false;
    let totalMatchingMessages = Number(config.gmailTotalMatchingMessages ?? 0);
    let batchMessageIds = pendingIds;
    if (batchMessageIds.length === 0) {
      if (historyMode && historyStartId) {
        const params = new URLSearchParams({
          startHistoryId: historyStartId,
          historyTypes: "messageAdded",
          maxResults: String(maxResults)
        });
        if (historyNextPageToken) params.set("pageToken", historyNextPageToken);
        try {
          const history = await googleJson(`https://gmail.googleapis.com/gmail/v1/users/me/history?${params.toString()}`, auth.token);
          batchMessageIds = gmailHistoryMessageIds(history);
          historyNextPageToken = cleanText(history.nextPageToken);
          historyTargetId = cleanText(history.historyId) || historyTargetId;
          totalMatchingMessages = batchMessageIds.length;
          fetchedPage = true;
        } catch (error: any) {
          if (!/Google API respondio 404:/i.test(cleanText(error?.message))) throw error;
          // Gmail expires old history cursors. A one-day-overlap search safely rebuilds it.
          historyStartId = "";
          historyTargetId = "";
          historyNextPageToken = "";
          historySeedId = (await gmailProfile(auth.token)).historyId;
          const fallback = gmailSyncQueryForConfig({ ...config, gmailHistoryId: null }, false);
          const params = new URLSearchParams({ q: fallback.query, maxResults: String(maxResults) });
          const list = await googleJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`, auth.token);
          batchMessageIds = (list.messages ?? []).map((item: any) => cleanText(item.id)).filter(Boolean);
          nextPageToken = cleanText(list.nextPageToken);
          totalMatchingMessages = Number(list.resultSizeEstimate ?? totalMatchingMessages);
          fetchedPage = true;
          syncQuery.query = fallback.query;
          syncQuery.mode = "incremental";
          syncQuery.since = fallback.since;
        }
      } else {
        const pageToken = resetStoredQueue ? "" : cleanText(config.gmailNextPageToken);
        const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
        if (pageToken) params.set("pageToken", pageToken);
        const list = await googleJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`, auth.token);
        batchMessageIds = (list.messages ?? []).map((item: any) => cleanText(item.id)).filter(Boolean);
        nextPageToken = cleanText(list.nextPageToken);
        totalMatchingMessages = Number(list.resultSizeEstimate ?? totalMatchingMessages);
        fetchedPage = true;
      }
    }
    const messageIds = batchMessageIds.slice(0, maxMessages);
    const rows: CandidateImport[] = [];
    let reviewedAttachments = 0;
    let messagesWithAttachments = 0;
    let candidateAttachmentCount = 0;
    let skippedSystem = 0;
    let skippedNoSignal = 0;
    let parsedNoCandidate = 0;
    let stoppedByTime = false;
    let processedMessages = 0;
    const sampleAttachments: string[] = [];
    for (const id of messageIds) {
      if (Date.now() > deadlineMs) {
        stoppedByTime = true;
        break;
      }
      processedMessages += 1;
      const message = await googleJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, auth.token);
      const parsed = gmailMessageText(message);
      const attachments = await gmailAttachments(id, parsed.parts, auth.token, deadlineMs);
      const candidateAttachments = attachments.filter(gmailAttachmentLooksCandidate);
      if (attachments.length > 0) messagesWithAttachments += 1;
      reviewedAttachments += attachments.length;
      candidateAttachmentCount += candidateAttachments.length;
      sampleAttachments.push(...attachments.map((attachment) => attachment.fileName).filter(Boolean));
      if (!gmailShouldImport(parsed, attachments)) {
        if (gmailLooksLikeSystemMessage(parsed)) skippedSystem += 1;
        else skippedNoSignal += 1;
        continue;
      }
      const attachmentsToImport = candidateAttachments;
      if (attachmentsToImport.length === 0) {
        parsedNoCandidate += 1;
        continue;
      }
      for (const attachment of attachmentsToImport) {
        const documentText = `${attachment.fileName}\n${attachment.rawText ?? ""}`.trim();
        const contactText = `${documentText}\n${parsed.from}`.slice(0, 5000);
        const candidate = candidateFromFreeText("gmail", documentText, {
          sourceId: attachment.sourceId || `gmail:${id}:${attachment.fileName}`,
          sourceUrl: `https://mail.google.com/mail/u/0/#all/${id}`,
          currentRole: parsed.subject,
          fileName: attachment.fileName || parsed.subject || "Correo Gmail",
          fallbackName: attachment.fileName || parsed.subject,
          sender: parsed.from,
          contactText
        });
        if (!candidate) {
          parsedNoCandidate += 1;
          continue;
        }
        const cleanRawText = cleanDocumentTextForImport(attachment.rawText || candidate.documents?.[0]?.rawText || documentText);
        candidate.documents = [{
          type: "cv",
          fileName: attachment.fileName || candidate.documents?.[0]?.fileName || parsed.subject || "CV Gmail",
          rawText: cleanRawText || undefined,
          mimeType: attachment.mimeType,
          fileDataBase64: attachment.fileDataBase64,
          sizeBytes: attachment.sizeBytes,
          fileHash: attachment.fileHash,
          sourceId: attachment.sourceId || candidate.sourceId,
          sourcePath: attachment.sourcePath || candidate.sourceUrl,
          isPrimaryCv: true
        }];
        rows.push(candidate);
      }
    }
    const remainingPendingIds = batchMessageIds.slice(processedMessages);
    const hasMore = remainingPendingIds.length > 0 || Boolean(syncQuery.mode === "history" ? historyNextPageToken : nextPageToken);
    const finishedAt = new Date().toISOString();
    const completedHistoricalAt = !hasMore && syncQuery.mode === "historical" ? finishedAt : (cleanText(config.gmailBackfillCompleteAt) || null);
    const lastIncrementalSyncAt = !hasMore && (syncQuery.mode === "incremental" || syncQuery.mode === "history") ? finishedAt : (cleanText(config.gmailLastIncrementalSyncAt) || null);
    let committedHistoryId = storedHistoryId || null;
    if (!hasMore && syncQuery.mode === "history") {
      committedHistoryId = historyTargetId || historyStartId || storedHistoryId || null;
    } else if (!hasMore && syncQuery.mode !== "historical" && syncQuery.mode !== "custom") {
      committedHistoryId = historySeedId || (await gmailProfile(auth.token)).historyId || committedHistoryId;
    } else if (!hasMore && syncQuery.mode === "historical") {
      committedHistoryId = historySeedId || (await gmailProfile(auth.token)).historyId || committedHistoryId;
    }
    const sampleText = unique(sampleAttachments).slice(0, 5).join(", ");
    const progressText = totalMatchingMessages ? ` de aprox. ${totalMatchingMessages}` : "";
    const modeText = syncQuery.mode === "history" ? "modo correos nuevos" : (syncQuery.mode === "incremental" ? `modo nuevos desde ${syncQuery.since}` : (syncQuery.mode === "custom" ? "modo busqueda personalizada" : "modo historico"));
    const diagnostic = `Gmail (${modeText}): procesados ${processedMessages}${progressText} correos de la tanda, ${messagesWithAttachments} con adjuntos, ${reviewedAttachments} adjuntos PDF/Word/texto revisados, ${candidateAttachmentCount} con pinta de CV, ${rows.length} candidatos extraidos. Ignorados: ${skippedSystem} sistema, ${skippedNoSignal} sin senales, ${parsedNoCandidate} sin nombre/contacto.${hasMore ? " Quedan mas correos: volve a sincronizar para seguir importando." : " Se llego al final de la busqueda guardada; las proximas sincronizaciones van a revisar solo correos nuevos."}${stoppedByTime ? " Se corto por tiempo y guardo resultado parcial." : ""}${sampleText ? ` Adjuntos ejemplo: ${sampleText}.` : ""}`;
    return {
      rows,
      configUpdate: {
        ...auth.configUpdate,
        sessionStatus: "connected",
        lastAgentMessage: diagnostic,
        sessionLastError: null,
        gmailQuery: query,
        gmailNextPageToken: remainingPendingIds.length ? nextPageToken : (nextPageToken || null),
        gmailPendingMessageIds: remainingPendingIds,
        gmailHistoryId: committedHistoryId,
        gmailHistoryStartId: hasMore && syncQuery.mode === "history" ? historyStartId : null,
        gmailHistoryTargetId: hasMore && syncQuery.mode === "history" ? historyTargetId : null,
        gmailHistoryNextPageToken: hasMore && syncQuery.mode === "history" ? historyNextPageToken : null,
        gmailHistorySyncActive: syncQuery.mode === "history" && hasMore,
        gmailHistorySeedId: hasMore && syncQuery.mode !== "history" ? historySeedId : null,
        gmailTotalMatchingMessages: totalMatchingMessages,
        gmailLastFetchedNewPage: fetchedPage,
        gmailHasMore: hasMore,
        gmailSyncMode: syncQuery.mode,
        gmailIncrementalSince: syncQuery.since || null,
        gmailBackfillCompleteAt: completedHistoricalAt,
        gmailLastIncrementalSyncAt: lastIncrementalSyncAt
      },
      message: diagnostic
    };
  } catch (error: any) {
    return {
      rows: [],
      configUpdate: {
        ...auth.configUpdate,
        sessionStatus: "requires_oauth",
        sessionLastError: `Gmail API no funciono: ${cleanText(error?.message).slice(0, 180)}`
      },
      message: `Gmail API no funciono: ${cleanText(error?.message).slice(0, 180)}`
    };
  }
}

async function scrapeDrive(config: Record<string, unknown>): Promise<AgentSyncResult> {
  let auth: Awaited<ReturnType<typeof googleAccessToken>> = null;
  try {
    auth = await googleAccessToken(config);
  } catch (error: any) {
    return {
      rows: [],
      configUpdate: {
        sessionStatus: "requires_oauth",
        sessionLastError: `Google Drive OAuth no funciono: ${cleanText(error?.message).slice(0, 180)}`
      },
      message: `Google Drive OAuth no funciono: ${cleanText(error?.message).slice(0, 180)}`
    };
  }
  if (!auth) {
    return {
      rows: [],
      configUpdate: {
        sessionStatus: "requires_oauth",
        sessionLastError: "Google Drive necesita OAuth completo de Google: Client ID, Client secret y refresh token."
      },
      message: "Google Drive no tiene OAuth completo. Conecta Google antes de sincronizar archivos."
    };
  }
  try {
    auth.configUpdate = { ...auth.configUpdate, ...(await googleAccountConfigUpdate("drive", auth.token, config)) };
  } catch (error: any) {
    const message = cleanText(error?.message).slice(0, 240);
    return {
      rows: [],
      configUpdate: {
        ...auth.configUpdate,
        sessionStatus: "requires_oauth",
        sessionLastError: message,
        oauthStatus: "wrong_account"
      },
      message
    };
  }
  try {
    const maxResults = numberFromConfig(config.maxResults, 50);
    const query = cleanText(config.query) || "trashed=false and (name contains 'cv' or name contains 'CV' or name contains 'curriculum' or name contains 'Curriculum' or name contains 'resume' or name contains 'candidato')";
    const list = await googleJson(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&pageSize=${maxResults}&fields=files(id,name,mimeType,webViewLink)`, auth.token);
    const rows: CandidateImport[] = [];
    for (const file of list.files ?? []) {
      let text = `${file.name}\n${file.webViewLink ?? ""}`;
      try {
        const isGoogleDoc = String(file.mimeType).includes("google-apps.document");
        const exportUrl = isGoogleDoc
          ? `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain`
          : `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;
        const response = await fetch(exportUrl, { headers: { authorization: `Bearer ${auth.token}` } });
        const downloaded = await response.text();
        if (response.ok) text += `\n${downloaded.slice(0, 15000)}`;
      } catch {
        // Metadata still gives useful matching for filenames and links.
      }
      const candidate = candidateFromFreeText("drive", text, {
        sourceId: `drive:${file.id}`,
        sourceUrl: file.webViewLink,
        fileName: file.name,
        fallbackName: file.name
      });
      if (candidate) rows.push(candidate);
    }
    return {
      rows,
      configUpdate: { ...auth.configUpdate, sessionStatus: "connected", lastAgentMessage: `Drive: ${rows.length} candidatos detectados.` },
      message: `Google Drive: ${list.files?.length ?? 0} archivos revisados, ${rows.length} candidatos detectados.`
    };
  } catch (error: any) {
    return {
      rows: [],
      configUpdate: {
        ...auth.configUpdate,
        sessionStatus: "requires_oauth",
        sessionLastError: `Google Drive API no funciono: ${cleanText(error?.message).slice(0, 180)}`
      },
      message: `Google Drive API no funciono: ${cleanText(error?.message).slice(0, 180)}`
    };
  }
}

async function fetchBuscojobsJson(url: string, config: Record<string, unknown>) {
  const auth = authFromConfig(config);
  if (!auth.authorization) throw new Error("Falta authorization Bearer de Buscojobs. Copia una llamada Fetch/XHR como cURL.");

  const response = await fetch(url, {
    headers: {
      accept: "application/json, text/plain, */*",
      "accept-language": "es",
      authorization: `Bearer ${auth.authorization}`,
      origin: "https://www.buscojobs.com.uy",
      referer: "https://www.buscojobs.com.uy/",
      "sessionid": auth.sessionId ?? "",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36",
      "x-timezone-offset": "180"
    }
  });
  const text = await response.text();
  if (response.status === 304) {
    throw new Error("Buscojobs devolvio cache 304. Copia otra vez la llamada como cURL con Disable cache activado.");
  }
  if (response.status === 401 && /JWTExpired|INVALID_TOKEN|claim timestamp check failed/i.test(text)) {
    throw new Error("La sesion/API de Buscojobs vencio.");
  }
  if (!response.ok) throw new Error(`Buscojobs API respondio ${response.status}: ${text.slice(0, 160)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Buscojobs no devolvio JSON: ${text.slice(0, 160)}`);
  }
}

async function tryFetchBuscojobsJson(url: string, config: Record<string, unknown>) {
  try {
    return await fetchBuscojobsJson(url, config);
  } catch (error: any) {
    if (/respondio (40[034]|50\d)/i.test(error?.message ?? "")) return null;
    return null;
  }
}

function buscojobsOfferEndpointUrls(config: Record<string, unknown>) {
  const limit = Number(config.maxOffers ?? 80);
  const activeFilter = encodeURIComponent(JSON.stringify({ order: ["FechaInicio DESC"], limit, skip: 0 }));
  const allFilter = encodeURIComponent(JSON.stringify({ order: ["FechaInicio DESC"], limit, skip: 0 }));
  const ids = buscojobsEmpresaIds(config);
  return unique(ids.flatMap((empresaId) => [
    `https://api.buscojobs.com/v3/uy/api/empresas/${empresaId}/OfertasActivas?filter=${activeFilter}`,
    `https://api.buscojobs.com/v3/uy/api/empresas/${empresaId}/Ofertas?filter=${allFilter}`,
    `https://api.buscojobs.com/v3/uy/api/empresas/${empresaId}/ofertas?filter=${allFilter}`,
    `https://api.buscojobs.com/v3/uy/api/empresas/${empresaId}/MisOfertas?filter=${allFilter}`,
    `https://api.buscojobs.com/v3/uy/api/OfertasActivas?filter=${encodeURIComponent(JSON.stringify({ where: { EmpresaId: Number(empresaId) }, order: ["FechaInicio DESC"], limit, skip: 0 }))}`,
    `https://api.buscojobs.com/v3/uy/api/Ofertas?filter=${encodeURIComponent(JSON.stringify({ where: { EmpresaId: Number(empresaId) }, order: ["FechaInicio DESC"], limit, skip: 0 }))}`,
    `https://api.buscojobs.com/v3/uy/api/OfertaEmpresaTodas?filter=${encodeURIComponent(JSON.stringify({ where: { EmpresaId: Number(empresaId) }, order: ["FechaInicio DESC"], limit, skip: 0 }))}`,
    `https://api.buscojobs.com/v3/uy/api/OfertasEmpresaTodas?filter=${encodeURIComponent(JSON.stringify({ where: { EmpresaId: Number(empresaId) }, order: ["FechaInicio DESC"], limit, skip: 0 }))}`
  ]));
}

function offerRowsFromPayload(payload: unknown) {
  const rows = arrayFromPayload(payload);
  const nested = collectOfferLikeRows(payload);
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of [...rows, ...nested]) {
    const id = offerIdFromRow(row);
    const title = offerTitleFromRow(row);
    if (!id && !compactLabel(title)) continue;
    if (candidatesFromBuscojobsPayload(row).length > 0) continue;
    byId.set(id || title, row);
  }
  return [...byId.values()];
}

async function fetchBuscojobsOffers(config: Record<string, unknown>) {
  const routes = buscojobsOfferEndpointUrls(config);
  const notes: string[] = [];
  for (const url of routes) {
    const payload = await tryFetchBuscojobsJson(url, config);
    const offers = payload ? offerRowsFromPayload(payload) : [];
    notes.push(`${url.replace(/\?.*$/, "")}: ${offers.length}`);
    if (offers.length > 0) return { offers, route: url.replace(/\?.*$/, ""), notes };
  }
  return { offers: [] as Record<string, unknown>[], route: "", notes };
}

async function scrapeBuscojobsWithApi(config: Record<string, unknown>, prefix = ""): Promise<AgentSyncResult> {
  const auth = authFromConfig(config);
  const apiUrl = apiUrlFromCurl(config);
  if (!auth.authorization) throw new Error("Buscojobs no tiene token/API valido para consultar postulantes.");

  let baseUrl = apiUrl ?? buscojobsOfferEndpointUrls(config)[0];
  let payload: any;
  try {
    payload = await fetchBuscojobsJson(baseUrl, config);
  } catch (error: any) {
    if (!apiUrl || /sesion\/API de Buscojobs vencio|JWTExpired|INVALID_TOKEN/i.test(error?.message ?? "")) throw error;
    baseUrl = buscojobsOfferEndpointUrls(config)[0];
    if (!baseUrl) throw error;
    payload = await fetchBuscojobsJson(baseUrl, config);
  }
  const directCandidates = candidatesFromBuscojobsPayload(payload);
  let offers = offerRowsFromPayload(payload);
  const baseLooksLikeApplicants = directCandidates.length > 0 && (
    /postul|candidat|curriculum|cv/i.test(baseUrl)
    || directCandidates.length >= Math.max(1, Math.floor(offers.length * 0.5))
  );
  if (baseLooksLikeApplicants) {
    return {
      rows: directCandidates,
      message: `${prefix}Buscojobs: ${directCandidates.length} postulantes detectados directamente desde la llamada/API.`
    };
  }
  let offerRoute = baseUrl.replace(/\?.*$/, "");
  let discoveryNotes: string[] = [];
  if (offers.length === 0) {
    const discovered = await fetchBuscojobsOffers(config);
    offers = discovered.offers;
    offerRoute = discovered.route;
    discoveryNotes = discovered.notes;
  }
  if (offers.length === 0) {
    throw new Error(`Buscojobs inicio sesion pero no encontro ofertas. EmpresaIds probados: ${buscojobsEmpresaIds(config).join(", ") || "ninguno"}. Rutas: ${discoveryNotes.slice(0, 5).join(" | ") || "sin rutas disponibles"}.`);
  }

  const candidates: CandidateImport[] = [];
  const routeNotes: string[] = [];
  const maxOffers = Number(config.maxOffers ?? 50);

  for (const offer of offers.slice(0, maxOffers)) {
    const result = await fetchApplicantsForOffer(config, offer);
    candidates.push(...result.rows);
    const offerTitle = compactLabel(offerTitleFromRow(offer), `Oferta ${offerIdFromRow(offer) || "sin id"}`);
    routeNotes.push(`${offerTitle}: ${result.rows.length}`);
  }

  const deduped = new Map<string, CandidateImport>();
  for (const candidate of candidates) deduped.set(candidate.sourceId ?? candidate.fullName, candidate);

  return {
    rows: [...deduped.values()],
    message: `${prefix}Buscojobs: ${offers.length} ofertas leidas desde ${offerRoute || "API"}, ${deduped.size} candidatos detectados. ${routeNotes.slice(0, 6).join(" | ")}`
  };
}

async function scrapeBuscojobsWithFallback(config: Record<string, unknown>, reason: string, prefix = ""): Promise<AgentSyncResult> {
  const notes: string[] = [];
  const cookieHeader = cookieHeaderFromConfig(config);
  if (cookieHeader) {
    try {
      return await scrapeBuscojobsWithCookies(config, cookieHeader, `${prefix}Buscojobs: la API fallo; se intento con cookies. `);
    } catch (error: any) {
      notes.push(`cookies: ${cleanText(error?.message).slice(0, 120)}`);
    }
  }

  const refreshedCookies = await loginBuscojobsWithCredentials(config);
  if (refreshedCookies) {
    try {
      const result = await scrapeBuscojobsWithCookies(config, refreshedCookies, `${prefix}Buscojobs: la API fallo; se reconecto con usuario/contrasena. `);
      return {
        ...result,
        configUpdate: {
          sessionCookies: refreshedCookies,
          sessionStatus: "connected",
          sessionRefreshedAt: new Date().toISOString(),
          sessionLastError: null
        }
      };
    } catch (error: any) {
      notes.push(`login simple: ${cleanText(error?.message).slice(0, 120)}`);
    }
  }

  try {
    return await scrapeBuscojobsWithBrowser(
      { ...config, apiKey: null, token: null, accessToken: null },
      `${prefix}Buscojobs: la API fallo; se intento navegador automatico. `
    );
  } catch (error: any) {
    notes.push(`navegador: ${cleanText(error?.message).slice(0, 120)}`);
  }

  const message = `Buscojobs no pudo sincronizar. API fallo: ${reason.slice(0, 140)}. Fallbacks: ${notes.join(" | ") || "sin cookies/sesion usable"}.`;
  return {
    rows: [],
    configUpdate: {
      sessionStatus: "requires_reconnect",
      sessionFailedAt: new Date().toISOString(),
      sessionLastError: message
    },
    message
  };
}

function arrayFromPayload(payload: any): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter((item) => typeof item === "object" && item !== null);
  for (const key of ["data", "rows", "items", "results", "postulaciones", "postulantes", "candidatos", "curriculums"]) {
    const value = payload?.[key];
    if (Array.isArray(value)) return value.filter((item) => typeof item === "object" && item !== null);
  }
  if (typeof payload === "object" && payload !== null) {
    const nested = Object.values(payload).find((value) => Array.isArray(value)) as unknown[] | undefined;
    if (nested) return nested.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
  }
  return [];
}

function collectCandidateLikeRows(value: unknown, depth = 0): Record<string, unknown>[] {
  if (!value || depth > 5) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectCandidateLikeRows(item, depth + 1));
  }
  if (typeof value !== "object") return [];

  const row = value as Record<string, unknown>;
  const nested = Object.values(row).flatMap((item) => collectCandidateLikeRows(item, depth + 1));
  const isCandidateLike = hasMatchingKey(row, [
    /postulante/,
    /candidato/,
    /curriculum|curriculo|\bcv\b/,
    /persona/,
    /^email$|^mail$|correo/,
    /telefono|celular|mobile|phone/,
    /linkedin/,
    /fecha.*postul/
  ]);
  return isCandidateLike ? [row, ...nested] : nested;
}

function collectOfferLikeRows(value: unknown, depth = 0): Record<string, unknown>[] {
  if (!value || depth > 5) return [];
  if (Array.isArray(value)) return value.flatMap((item) => collectOfferLikeRows(item, depth + 1));
  if (typeof value !== "object") return [];

  const row = value as Record<string, unknown>;
  const nested = Object.values(row).flatMap((item) => collectOfferLikeRows(item, depth + 1));
  const isOfferLike = hasMatchingKey(row, [
    /^oferta(id)?$/i,
    /oferta.*id/i,
    /titulo|cargo|puesto|vacante|fecha.*inicio|estado/i
  ]);
  const isApplicantLike = hasMatchingKey(row, [/postulante/, /candidato/, /curriculum|curriculo|\bcv\b/, /^email$|correo/, /telefono|celular/]);
  return isOfferLike && !isApplicantLike ? [row, ...nested] : nested;
}

function extractEmails(value: unknown) {
  const values = Array.isArray(value) ? value : [value];
  return unique(values.flatMap((item) => cleanText(item).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []))
    .map((item) => item.toLowerCase());
}

function textWithoutReferenceSections(value: unknown) {
  return cleanText(value)
    .split(/\b(?:referencias?|references?|ref\.?)\b/i)[0]
    .slice(0, 12000);
}

function extractPhones(value: unknown) {
  const values = Array.isArray(value) ? value : [value];
  const matches = values.flatMap((item) => textWithoutReferenceSections(item).match(/(?:\+?\d{1,3}[\s.-]?)?(?:0?9\d|2\d|4\d|[1-9]\d{1,3})[\s.-]?\d{3}[\s.-]?\d{3,4}/g) ?? []);
  return unique(matches)
    .map((phone) => phone.replace(/[^\d+]+/g, " ").replace(/\s+/g, " ").trim())
    .filter((phone) => {
      const digits = phone.replace(/\D/g, "");
      if (digits.length < 7 || digits.length > 15) return false;
      if (digits.length > 9 && !digits.startsWith("598")) return false;
      if (/^0+$/.test(digits)) return false;
      if (/^(\d)\1{6,}$/.test(digits)) return false;
      if (/^(?:0 ?){4,}/.test(phone)) return false;
      if (/^(?:19|20)\d{6}(?:\d{4,6})?$/.test(digits)) return false;
      if (/^(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{6}$/.test(digits)) return false;
      if (/^(?:\d{1,2}) ?(?:\d{1,2}) ?0{5,}$/.test(phone)) return false;
      return true;
    })
    .slice(0, 3);
}

function offerIdFromRow(row: Record<string, unknown>) {
  return deepFirstText(row, ["Id", "id", "OfertaId", "ofertaId", "OfertaID", "ofertaID", "IdOferta", "idOferta", "Codigo", "codigo"])
    ?? firstMatchingKeyText(row, [/^id$/, /oferta.*id/, /id.*oferta/, /codigo/]);
}

function offerTitleFromRow(row: Record<string, unknown>) {
  return deepFirstText(row, ["Titulo", "titulo", "Nombre", "nombre", "Cargo", "cargo", "Puesto", "puesto", "Descripcion", "descripcion"])
    ?? firstMatchingKeyText(row, [/titulo/, /nombre/, /cargo/, /puesto/])
    ?? "Oferta Buscojobs";
}

function candidateDocumentsFromRow(row: Record<string, unknown>, sourceType: string) {
  const cvUrl = deepFirstText(row, ["CVUrl", "cvUrl", "CurriculumUrl", "curriculumUrl", "UrlCv", "urlCv", "ArchivoUrl", "archivoUrl", "FileUrl", "fileUrl", "DownloadUrl", "downloadUrl", "DocumentoUrl", "documentoUrl", "CV", "cv", "Curriculum", "curriculum"]);
  const profileUrl = deepFirstText(row, ["PerfilUrl", "perfilUrl", "ProfileUrl", "profileUrl", "Url", "url"]);
  const cvText = deepFirstText(row, ["CvTexto", "cvTexto", "TextoCV", "textoCV", "RawText", "rawText", "ResumenCV", "resumenCV", "CVTexto", "cv_texto", "CurriculumTexto", "Experiencia", "experiencia", "Formacion", "formacion", "Educacion", "educacion"]);
  const fileName = deepFirstText(row, ["FileName", "fileName", "NombreArchivo", "nombreArchivo", "CvNombre", "cvNombre"]);
  const documents = [];

  const looksLikeUrl = cvUrl && /^https?:\/\//i.test(cvUrl);
  const inlineCvText = cvText ?? (cvUrl && !looksLikeUrl && cvUrl.length > 80 ? cvUrl : null);

  if (looksLikeUrl || inlineCvText) {
    documents.push({
      type: "cv",
      fileName: fileName || "CV importado",
      fileUrl: looksLikeUrl ? cvUrl : null,
      rawText: inlineCvText,
      sourceId: deepFirstText(row, ["CurriculumId", "curriculumId", "CvId", "cvId", "Id", "id"]),
      isPrimaryCv: true
    });
  }

  if (profileUrl && profileUrl !== cvUrl) {
    documents.push({
      type: "profile",
      fileName: `${sourceType} ficha`,
      fileUrl: profileUrl,
      sourceId: deepFirstText(row, ["PostulanteId", "postulanteId", "CandidatoId", "candidatoId", "Id", "id"]),
      isPrimaryCv: false
    });
  }

  return documents;
}

function looksLikeOfferText(value: unknown) {
  return /buscamos|estamos buscando|importante empresa|requisitos|principales tareas|tareas:|jornada|carnet|perfil psicografico|postulantes|candidatos|oferta|\[object Object\]/i.test(cleanText(value));
}

export function isClearlyGenericCandidateName(name: string) {
  const normalized = name.replace(/\s+/g, " ").trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  return /^(atencion al cliente|auxiliar administrativ[oa]|administrativ[oa]|asesor(?:a)? comercial|ejecutiv[oa] comercial|vendedor(?:a)?|ventas(?: y marketing)?|recursos humanos|servicios generales|operador(?:a)?|recepcionista|cajer[oa]|repositor(?:a)?|logistica(?: y produccion)?|gastronomia|marketing|diseno grafico|desarrollador(?:a)?|programador(?:a)?|contador(?:a)?|abogad[oa]|enfermer[oa]|tecnico(?: especialista)?|mantenimiento|produccion|supervisor(?:a)?|encargad[oa])$/i.test(normalized);
}

function candidateNameLooksReal(name: string) {
  const cleaned = name.replace(/\s+/g, " ").trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (!cleaned || cleaned.length < 5 || cleaned.length > 90) return false;
  if (words.length < 2 || words.length > 6) return false;
  if (/\b(re|fw|fwd|gallito|postulame|postularme|postulaci[oó]n|postulaciones|vacante|vacantes|futuras|solicitud|empleo|trabajo|curriculum|curr[ií]culo|curriculo|curiculum|curriculun|curriculm|corriculun|corriculum|vitae|adjunto|consulta|buenas|hola|estimados|comparto|env[ií]o|envio|extracted|extracto|experiencia|laboral|deposito|dep[oó]sito|limpieza|atenci[oó]n|cliente|profesional|creativo|juvenil|femenino|morado|rosado|rosa|plantilla|modelo|minimalista|minimalist|mujer|hombre|persona|proactiv[oa]|organizada?|responsable|auxiliar|enfermer[ií]a|reponedor|pickers?|copia|imprimir|chofer|cadete|audiovisual|foto|photo|imagen|image|sencillo|cl[aá]sico|clasico|blanco|beige|simple|compressed|comprimido|ultimo|último|call|automation|financiero|financiera|especialista|gratis|solymarpdf|actividades?)\b/i.test(cleaned)) return false;
  if (/^(soy una|soy un|para\s+)/i.test(cleaned)) return false;
  if (isClearlyGenericCandidateName(cleaned)) return false;
  if (/\b(fecha|nacimiento|domicilio|direcci[oó]n|cedula|c[eé]dula|documento|telefono|tel[eé]fono|celular|email|correo|uruguay)\b/i.test(cleaned)) return false;
  if (/\b(de|del|de la|la|las|los|y)$/i.test(cleaned)) return false;
  if (/\d/.test(cleaned)) return false;
  if (/[/{}<>]|\[object Object\]/i.test(cleaned)) return false;
  if (looksLikeOfferText(cleaned)) return false;
  if (/^(autodromo|barra de carrasco|ciudad de la costa|comercial|comercial mercadeo|el pinar|fray bentos|jose pedro varela|las piedras|libertad|lomas de solymar|malvin|melo|montevideo|neptunia|playa pascual|rivera|salinas|salto|solymar|suarez|toledo|treinta y tres|administracion de empresas|asistencia social|asesor financiero|asesora financiera|diseno grafico|profesional creativo morado|profesional juvenil femenino rosado|plantilla curriculum|modelo curriculum|qa automation)$/i.test(cleaned)) return false;
  return true;
}

function compactLabel(value: unknown, fallback = "") {
  const text = fixMojibake(cleanText(value)).replace(/\s+/g, " ");
  if (/^(postgres|postgresql|database|supabase|render|gmail|google|cv|curriculum|currículo|currículum|curriculo|vitae|pdf|doc|docx|rtf|txt)$/i.test(text)) return fallback;
  if (/\b(postulaci[oó]n laboral|postulaci[oó]n|entrega de cv|adjunto cv|adjunto curriculum|futuras oportunidades|futuras vacantes|solicitud de empleo|solicitud laboral|trabajo\/empleo|datos personales|nombre completo|tareas realizadas|ref:|referencia:)\b/i.test(text)) return fallback;
  if (/^(para\s+|cargo\s*:|puesto\s*:)/i.test(text)) return fallback;
  if (!text || looksLikeOfferText(text) || text.length > 70) return fallback;
  return text;
}

function safeTags(items: unknown[], sourceType: string) {
  return unique([sourceType, ...items.map((item) => compactLabel(item)).filter(Boolean)]).slice(0, 6);
}

function candidateSummaryLooksLikeOffer(candidate: CandidateImport) {
  return looksLikeOfferText(`${candidate.fullName} ${candidate.currentRole ?? ""} ${candidate.summary ?? ""}`);
}

export function isUsableCandidate(candidate: CandidateImport, sourceType = "") {
  const hasContact = candidate.email.length > 0 || candidate.phone.length > 0 || Boolean(candidate.linkedinUrl);
  const hasDocument = (candidate.documents ?? []).some((document) => Boolean(document.fileUrl || document.sourcePath || document.sourceId || document.rawText));
  const hasRealName = candidateNameLooksReal(candidate.fullName);
  const documentSource = sourceType === "drive" || sourceType === "gmail";
  const automaticSource = documentSource || sourceType === "buscojobs" || sourceType === "aglh" || sourceType === "yoiners";

  if (automaticSource && !hasDocument) return false;

  if (documentSource) {
    return Boolean(hasRealName || hasContact);
  }

  if (sourceType === "buscojobs") {
    if (!hasRealName) return false;
    if (candidateSummaryLooksLikeOffer(candidate) && !hasContact && !hasDocument) return false;
    return true;
  }

  if (hasContact) return true;
  if (!hasRealName) return false;
  if (candidateSummaryLooksLikeOffer(candidate)) return false;
  return true;
}
function isAgentCandidate(row: unknown): row is CandidateImport {
  const candidate = row as CandidateImport;
  return Boolean(candidate && typeof candidate === "object" && typeof candidate.fullName === "string" && Array.isArray(candidate.email) && Array.isArray(candidate.phone) && Array.isArray(candidate.tags));
}
function applicantFromRow(row: Record<string, unknown>, offer: Record<string, unknown>): CandidateImport | null {
  const personContainer = row.Postulante ?? row.postulante ?? row.Candidato ?? row.candidato ?? row.Curriculum ?? row.curriculum ?? row.Persona ?? row.persona;
  const rowLooksApplicant = hasMatchingKey(row, [
    /postulante/,
    /candidato(nombre|id|apellido|email|telefono|celular)/,
    /curriculum|curriculo/,
    /\bcv(url|id|texto|nombre)?\b/,
    /persona/,
    /^email$|^mail$|correo/,
    /telefono|celular|mobile|phone/,
    /fecha.*postul/,
    /adecuacion/
  ]);
  if (!personContainer && !rowLooksApplicant) return null;

  const person = (personContainer ?? row) as Record<string, unknown>;
  const fullNameKeys = personContainer
    ? ["NombreCompleto", "nombreCompleto", "FullName", "fullName", "PostulanteNombre", "postulanteNombre", "CandidatoNombre", "candidatoNombre", "Nombre", "nombre"]
    : ["NombreCompleto", "nombreCompleto", "FullName", "fullName", "PostulanteNombre", "postulanteNombre", "CandidatoNombre", "candidatoNombre"];
  const firstName = deepFirstText(person, ["PrimerNombre", "Nombres", "NombrePila", "firstName", "FirstName"]);
  const lastName = deepFirstText(person, ["Apellido", "Apellidos", "lastName", "LastName"]);
  const fullName = deepFirstText(person, fullNameKeys)
    ?? unique([firstName, lastName].filter(Boolean) as string[]).join(" ")
    ?? firstMatchingKeyText(person, [/nombre.*completo/, /full.*name/, /postulante.*nombre/, /candidat.*nombre/]);
  const email = unique([
    ...listFrom(deepFirstText(person, ["Email", "email", "Mail", "mail", "Correo", "correo", "EmailContacto", "emailContacto"]) ?? deepFirstText(row, ["Email", "email", "Mail", "mail", "Correo", "correo", "EmailContacto", "emailContacto"])),
    ...extractEmails(JSON.stringify(row))
  ]);
  const phone = unique([
    ...listFrom(deepFirstText(person, ["Telefono", "telefono", "Celular", "celular", "Mobile", "mobile", "Phone", "phone", "TelefonoContacto", "telefonoContacto"]) ?? deepFirstText(row, ["Telefono", "telefono", "Celular", "celular", "Mobile", "mobile", "Phone", "phone", "TelefonoContacto", "telefonoContacto"])),
    ...extractPhones(JSON.stringify(row))
  ]);
  const sourceId = deepFirstText(row, ["PostulacionId", "postulacionId", "PostulanteId", "postulanteId", "CandidatoId", "candidatoId", "CurriculumId", "curriculumId"])
    ?? firstMatchingKeyText(row, [/postul.*id/, /candidat.*id/, /curriculum.*id/])
    ?? deepFirstText(person, ["Id", "id"]);

  const cleanedName = fullName?.replace(/\s+/g, " ").trim() ?? "";
  const offerTitle = offerTitleFromRow(offer);
  if (cleanedName && compactLabel(cleanedName) === compactLabel(offerTitle)) return null;
  if (!candidateNameLooksReal(cleanedName) && email.length === 0 && phone.length === 0) return null;

  const scoreText = deepFirstText(row, ["Adecuacion", "adecuacion", "Score", "score", "Puntaje", "puntaje"]);
  const qualityScore = scoreText && Number.isFinite(Number(scoreText)) ? Math.max(0, Math.min(100, Number(scoreText))) : 0;
  const sourceUrl = deepFirstText(row, ["PerfilUrl", "perfilUrl", "ProfileUrl", "profileUrl", "Url", "url", "CVUrl", "cvUrl"]);
  const documents = candidateDocumentsFromRow(row, "buscojobs");
  const city = deepFirstText(person, ["Ciudad", "ciudad", "Localidad", "localidad", "Ubicacion", "ubicacion"]) ?? deepFirstText(row, ["Ciudad", "ciudad"]);
  const summaryParts = [
    offerTitle ? `Postulante a ${offerTitle}` : null,
    city ? `Ubicacion: ${city}` : null,
    documents.find((document) => document.rawText)?.rawText?.slice(0, 700) ?? null
  ].filter(Boolean);

  const candidate: CandidateImport = {
    fullName: candidateNameLooksReal(cleanedName) ? cleanedName : (email[0] || phone[0]),
    firstName,
    lastName,
    email,
    phone,
    city,
    country: "Uruguay",
    linkedinUrl: deepFirstText(person, ["Linkedin", "linkedin", "LinkedInUrl", "linkedinUrl"]),
    currentRole: compactLabel(offerTitle, "Postulante Buscojobs"),
    seniority: null,
    years: null,
    tags: safeTags([offerTitle], "buscojobs"),
    summary: summaryParts.join(". ") || null,
    qualityScore,
    sourceId: sourceId ? `buscojobs:${sourceId}` : `buscojobs:${offerIdFromRow(offer)}:${cleanedName || email[0] || phone[0]}`,
    sourceUrl,
    documents,
    raw: { offer, applicant: row }
  };

  return isUsableCandidate(candidate, "buscojobs") ? candidate : null;
}
function applicantEndpointUrls(empresaId: string, offerId: string, limit: number, skip: number) {
  const filter = encodeURIComponent(JSON.stringify({ order: ["FechaPostulacion DESC"], limit, skip }));
  const whereFilter = encodeURIComponent(JSON.stringify({ where: { OfertaId: Number(offerId) }, order: ["FechaPostulacion DESC"], limit, skip }));
  return [
    `https://api.buscojobs.com/v3/uy/api/empresas/${empresaId}/ofertas/${offerId}/Postulaciones?filter=${filter}`,
    `https://api.buscojobs.com/v3/uy/api/empresas/${empresaId}/ofertas/${offerId}/Postulantes?filter=${filter}`,
    `https://api.buscojobs.com/v3/uy/api/empresas/${empresaId}/ofertas/${offerId}/Candidatos?filter=${filter}`,
    `https://api.buscojobs.com/v3/uy/api/empresas/${empresaId}/ofertas/${offerId}/Curriculums?filter=${filter}`,
    `https://api.buscojobs.com/v3/uy/api/ofertas/${offerId}/Postulaciones?filter=${filter}`,
    `https://api.buscojobs.com/v3/uy/api/ofertas/${offerId}/Postulantes?filter=${filter}`,
    `https://api.buscojobs.com/v3/uy/api/PostulacionOfertaTodas?filter=${whereFilter}`,
    `https://api.buscojobs.com/v3/uy/api/PostulacionesOfertaTodas?filter=${whereFilter}`,
    `https://api.buscojobs.com/v3/uy/api/empresas/${empresaId}/PostulacionOfertaTodas?filter=${whereFilter}`,
    `https://api.buscojobs.com/v3/uy/api/empresas/${empresaId}/PostulacionesOfertaTodas?filter=${whereFilter}`
  ];
}

async function fetchApplicantsForOffer(config: Record<string, unknown>, offer: Record<string, unknown>) {
  const offerId = offerIdFromRow(offer);
  if (!offerId) return { rows: [] as CandidateImport[], route: `sin-id ${JSON.stringify(offer).slice(0, 180)}` };

  const maxPages = Number(config.maxPagesPerOffer ?? 20);
  const limit = Number(config.pageSize ?? 50);
  const collected: CandidateImport[] = [];
  let workingRoute = "";

  for (let page = 0; page < maxPages; page += 1) {
    const skip = page * limit;
    const urls = unique(buscojobsEmpresaIds(config).flatMap((empresaId) => applicantEndpointUrls(empresaId, offerId, limit, skip)));
    let pageRows: Record<string, unknown>[] = [];

    for (const url of urls) {
      const payload = await tryFetchBuscojobsJson(url, config);
      const rows = payload ? arrayFromPayload(payload) : [];
      if (rows.length > 0) {
        pageRows = rows;
        workingRoute = url.replace(/\?.*$/, "");
        break;
      }
    }

    if (pageRows.length === 0) break;
    for (const row of pageRows) {
      const candidate = applicantFromRow(row, offer);
      if (candidate) collected.push(candidate);
    }
    if (pageRows.length < limit) break;
  }

  return { rows: collected, route: workingRoute || "sin-ruta" };
}

function candidatesFromBuscojobsPayload(payload: unknown, offer: Record<string, unknown> = {}) {
  const directRows = arrayFromPayload(payload);
  const nestedRows = collectCandidateLikeRows(payload);
  const candidates: CandidateImport[] = [];
  const seenRows = new Set<Record<string, unknown>>();

  for (const row of [...directRows, ...nestedRows]) {
    if (seenRows.has(row)) continue;
    seenRows.add(row);
    const candidate = applicantFromRow(row, offer) ?? normalizeCandidate(row, "buscojobs");
    if (candidate && isUsableCandidate(candidate, "buscojobs")) candidates.push(candidate);
  }

  const bySource = new Map<string, CandidateImport>();
  for (const candidate of candidates) bySource.set(candidate.sourceId ?? `${candidate.fullName}:${candidate.email[0] ?? ""}:${candidate.phone[0] ?? ""}`, candidate);
  return [...bySource.values()];
}

async function fetchBuscojobs(url: string, cookieHeader: string) {
  const response = await fetch(url, {
    headers: {
      cookie: cookieHeader,
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    },
    redirect: "follow"
  });
  const text = await response.text();
  if (!response.ok && response.status !== 404) throw new Error(`Buscojobs respondio ${response.status} en ${url}`);
  if (/login|iniciar sesi[oó]n|acceder/i.test(text) && !/Mi Panel|Mis Ofertas|Postulantes|Candidatos/i.test(text)) {
    throw new Error("La sesion de Buscojobs no entro al panel. Exporta cookies nuevas desde Chrome y guardalas otra vez.");
  }
  return text;
}

function extractLinks(html: string, base = "https://buscojobs.com.uy") {
  const links: Array<{ url: string; text: string }> = [];
  const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRegex.exec(html))) {
    const url = absoluteUrl(match[1], base);
    const text = htmlText(match[2]);
    if (url) links.push({ url, text });
  }
  return links;
}

function extractOfferLinks(html: string) {
  return unique(extractLinks(html)
    .filter((link) => /\/app\/empresa\/oferta-\d+/i.test(link.url))
    .map((link) => link.url.split(/[?#]/)[0]));
}

function candidateListUrls(offerUrl: string, offerHtml: string) {
  const fromLinks = extractLinks(offerHtml, offerUrl)
    .filter((link) => /ver candidatos|candidato|postulante|curriculum|cv/i.test(`${link.text} ${link.url}`))
    .map((link) => link.url);
  const id = offerUrl.match(/oferta-(\d+)/)?.[1];
  const guessed = id ? [
    `https://buscojobs.com.uy/app/empresa/oferta-${id}/candidatos`,
    `https://buscojobs.com.uy/app/empresa/oferta-${id}/postulantes`,
    `https://buscojobs.com.uy/app/empresa/oferta-${id}/curriculums`
  ] : [];
  return unique([...fromLinks, ...guessed]);
}

function looksLikePersonName(value: string) {
  const text = value.trim();
  if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]{5,80}$/.test(text)) return false;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 5) return false;
  return !/panel|oferta|candidato|postulado|preseleccionado|finalista|leer|mover|descargar|buscar|adecuacion|perfil/i.test(text);
}

function extractCandidatesFromHtml(html: string, sourceUrl: string, offerTitle: string, sourceType = "buscojobs") {
  const candidates: CandidateImport[] = [];
  const seen = new Set<string>();
  const links = extractLinks(html, sourceUrl);

  const addCandidate = (name: string, context: string, profileUrl?: string | null) => {
    const cleanName = normalizeWhitespace(name);
    if (!looksLikePersonName(cleanName)) return;
    const email = unique(context.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []);
    const phone = unique(context.match(/(?:\+?598\s?)?(?:0?9\d|2\d)\s?\d{3}\s?\d{3}/g) ?? []);
    const ageText = context.match(/(\d{2})\s*a[nñ]os/i)?.[1];
    const city = context.match(/(?:Montevideo|Canelones|Maldonado|San Jose|Colonia|Florida|Rocha|Paysandu|Salto|Rivera|Tacuarembo|Durazno|Soriano|Lavalleja|Artigas|Cerro Largo|Flores|Rio Negro|Treinta y Tres)(?:,\s*[^,|]+)?/i)?.[0] ?? null;
    const scoreText = context.match(/Adecuaci[oó]n\s*(\d{1,3})%/i)?.[1];
    const sourceKey = profileUrl || `${sourceUrl}#${cleanName}:${email[0] ?? ""}:${phone[0] ?? ""}`;
    const key = `${cleanName}|${sourceKey}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({
      fullName: cleanName,
      email,
      phone,
      city,
      country: "Uruguay",
      currentRole: offerTitle || null,
      years: null,
      tags: unique([sourceType, offerTitle].filter(Boolean)),
      summary: ageText ? `${ageText} anos. ${context.slice(0, 500)}` : context.slice(0, 500),
      qualityScore: scoreText ? Math.max(0, Math.min(100, Number(scoreText))) : 0,
      sourceId: `${sourceType}:${sourceKey}`,
      sourceUrl: profileUrl || sourceUrl,
      raw: { sourceType, sourceUrl, profileUrl, offerTitle, context }
    });
  };

  for (const link of links) {
    if (!looksLikePersonName(link.text)) continue;
    const position = html.indexOf(link.text);
    const around = position >= 0 ? html.slice(Math.max(0, position - 500), position + 1500) : "";
    const context = htmlText(around);
    addCandidate(link.text, context, link.url);
  }

  const plainText = htmlText(html);
  const emailMatches = [...plainText.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)];
  for (const match of emailMatches) {
    const index = match.index ?? 0;
    const context = plainText.slice(Math.max(0, index - 700), index + 900);
    const beforeEmail = context.slice(0, Math.max(0, context.indexOf(match[0])));
    const name = beforeEmail
      .split(/[|•·\n\r]/)
      .map((part) => normalizeWhitespace(part))
      .reverse()
      .find((part) => looksLikePersonName(part));
    if (name) addCandidate(name, context, sourceUrl);
  }

  const rowRegex = /([A-ZÁÉÍÓÚÜÑ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]{3,35}\s+[A-ZÁÉÍÓÚÜÑ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]{2,45})(?=[\s\S]{0,260}(?:Adecuaci[oó]n|Postulad|CV|Curriculum|Edad|a[nñ]os|Montevideo|Canelones|Maldonado|San Jose|Colonia|Florida|Rocha|Paysandu|Salto|Rivera))/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(plainText))) {
    const index = rowMatch.index;
    const context = plainText.slice(Math.max(0, index - 350), index + 900);
    addCandidate(rowMatch[1], context, sourceUrl);
  }

  return candidates;
}

async function browserLinks(page: any, pattern: RegExp) {
  const links = await page.evaluate(() => Array.from((globalThis as any).document.querySelectorAll("a"))
    .map((anchor) => ({
      href: (anchor as any).href,
      text: ((anchor as any).textContent ?? "").trim()
    }))
    .filter((link) => link.href));
  return unique((links as Array<{ href: string; text: string }>)
    .filter((link) => pattern.test(`${link.href} ${link.text}`))
    .map((link) => link.href.split(/[?#]/)[0]));
}

async function scrapeBuscojobsWithBrowser(config: Record<string, unknown>, prefix = ""): Promise<AgentSyncResult> {
  let playwright: any;
  try {
    playwright = await loadPlaywright();
  } catch {
    return {
      rows: [],
      configUpdate: {
        sessionStatus: "requires_browser",
        sessionFailedAt: new Date().toISOString(),
        sessionLastError: "El servidor no tiene navegador automatico instalado todavia. Hay que desplegar la version con Playwright."
      },
      message: "Buscojobs necesita navegador automatico para iniciar sesion. Desplega la version con Playwright."
    };
  }

  const browser = await playwright.chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    const storageState = browserStorageStateFromConfig(config);
    const context = await browser.newContext({
      ...(storageState ? { storageState } : {}),
      locale: "es-UY",
      timezoneId: "America/Montevideo",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36"
    });
    await addConfiguredBrowserCookies(context, config, "https://www.buscojobs.com.uy");
    const page = await context.newPage();
    page.setDefaultTimeout(15000);

    const loggedIn = await ensureBuscojobsBrowserSession(page, config);
    if (!loggedIn) {
      const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
      const blocked = /captcha|verifica que eres|verifica que sos|2fa|codigo|código/i.test(bodyText);
      return {
        rows: [],
        configUpdate: {
          sessionStatus: "requires_manual_login",
          sessionFailedAt: new Date().toISOString(),
          sessionLastError: blocked
            ? "Buscojobs mostro CAPTCHA/2FA/verificacion humana. TalentHub no puede saltearlo automaticamente."
            : "El navegador automatico no pudo completar el login con las credenciales guardadas."
        },
        message: blocked
          ? "Buscojobs pidio verificacion humana/CAPTCHA/2FA. Hace falta una autorizacion manual o un export/API oficial."
          : "Buscojobs no permitio iniciar sesion automaticamente con navegador. Revisa usuario/contrasena o endpoint de login."
      };
    }

    const panelUrl = "https://buscojobs.com.uy/app/empresa/panel";
    await page.goto(panelUrl, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => null);
    await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => null);
    let offerUrls = await browserLinks(page, /\/app\/empresa\/oferta-\d+|oferta|postulante|candidato/i);
    offerUrls = offerUrls.filter((url) => /\/app\/empresa\/oferta-\d+/i.test(url)).slice(0, Number(config.maxOffers ?? 80));

    const allCandidates: CandidateImport[] = [];
    const notes: string[] = [];
    for (const offerUrl of offerUrls) {
      try {
        await page.goto(offerUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => null);
        const offerHtml = await page.content();
        const offerTitle = htmlText(offerHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "")
          || htmlText(offerHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "")
          || "Oferta Buscojobs";
        const listUrls = unique([
          ...(await browserLinks(page, /candidato|postulante|curriculum|cv/i)),
          ...candidateListUrls(offerUrl, offerHtml)
        ]).slice(0, 6);
        let foundForOffer = 0;

        for (const listUrl of listUrls) {
          try {
            await page.goto(listUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
            await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => null);
            const listHtml = await page.content();
            const pageCandidates = extractCandidatesFromHtml(listHtml, page.url(), offerTitle);
            foundForOffer += pageCandidates.length;
            allCandidates.push(...pageCandidates);

            const paginationUrls = (await browserLinks(page, /pagina|page|p=\d+|offset|desde/i))
              .slice(0, Number(config.maxPagesPerOffer ?? 5));
            for (const pageUrl of paginationUrls) {
              await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
              await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => null);
              const extra = extractCandidatesFromHtml(await page.content(), page.url(), offerTitle);
              foundForOffer += extra.length;
              allCandidates.push(...extra);
            }
          } catch {
            continue;
          }
        }

        notes.push(`${compactLabel(offerTitle, "Oferta Buscojobs")}: ${foundForOffer}`);
      } catch {
        notes.push(`${offerUrl}: error`);
      }
    }

    const savedState = await context.storageState();
    const bySource = new Map<string, CandidateImport>();
    for (const candidate of allCandidates) bySource.set(candidate.sourceId ?? candidate.fullName, candidate);
    return {
      rows: [...bySource.values()],
      configUpdate: {
        browserStorageState: savedState,
        sessionStatus: "connected",
        sessionRefreshedAt: new Date().toISOString(),
        sessionLastError: null
      },
      message: `${prefix}Buscojobs navegador: ${offerUrls.length} ofertas revisadas, ${bySource.size} candidatos reales detectados. ${notes.slice(0, 6).join(" | ")}`
    };
  } finally {
    await browser.close().catch(() => null);
  }
}

async function scrapeGenericWebSource(sourceType: string, displayName: string, config: Record<string, unknown>): Promise<AgentSyncResult> {
  const baseUrl = cleanText(config.baseUrl ?? config.url);
  const searchUrls = unique([
    ...listFrom(config.searchUrls),
    baseUrl
  ]).filter(Boolean);
  if (searchUrls.length === 0) {
    return {
      rows: [],
      configUpdate: {
        sessionStatus: "requires_config",
        sessionLastError: `${displayName} necesita URL/baseUrl o searchUrls para saber donde buscar candidatos.`
      },
      message: `${displayName}: falta configurar URL/baseUrl o searchUrls.`
    };
  }

  let playwright: any;
  try {
    playwright = await loadPlaywright();
  } catch {
    return {
      rows: [],
      configUpdate: {
        sessionStatus: "requires_browser",
        sessionLastError: "El servidor no tiene navegador automatico instalado todavia."
      },
      message: `${displayName}: necesita navegador automatico desplegado.`
    };
  }

  const browser = await playwright.chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const storageState = browserStorageStateFromConfig(config);
    const context = await browser.newContext({
      ...(storageState ? { storageState } : {}),
      locale: "es-UY",
      timezoneId: "America/Montevideo",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36"
    });
    await addConfiguredBrowserCookies(context, config, searchUrls[0]);
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const loggedIn = await ensureGenericBrowserSession(page, config);
    if (!loggedIn) {
      return {
        rows: [],
        configUpdate: {
          sessionStatus: hasUsernamePassword(config) ? "requires_manual_login" : "requires_credentials",
          sessionFailedAt: new Date().toISOString(),
          sessionLastError: `${displayName} no pudo iniciar sesion. Revisa URL/login/credenciales o guarda cookies/sesion.`
        },
        message: `${displayName}: no pudo iniciar sesion o falta configurar credenciales/sesion.`
      };
    }

    const rows: CandidateImport[] = [];
    const visited = new Set<string>();
    const maxPages = numberFromConfig(config.maxPages, 30);
    const candidateLinkPattern = new RegExp(cleanText(config.candidateLinkPattern) || "candidato|postulante|talento|curriculum|cv|perfil|applicant|candidate", "i");
    const queue = [...searchUrls];

    while (queue.length > 0 && visited.size < maxPages) {
      const url = queue.shift();
      if (!url || visited.has(url)) continue;
      visited.add(url);
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => null);
        const html = await page.content();
        const title = htmlText(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "")
          || htmlText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "")
          || displayName;
        rows.push(...extractCandidatesFromHtml(html, page.url(), title, sourceType));
        const links = await browserLinks(page, candidateLinkPattern);
        for (const link of links.slice(0, 25)) {
          if (!visited.has(link) && queue.length + visited.size < maxPages) queue.push(link);
        }
      } catch {
        continue;
      }
    }

    const bySource = new Map<string, CandidateImport>();
    for (const candidate of rows) bySource.set(candidate.sourceId ?? `${candidate.fullName}:${candidate.email[0] ?? ""}`, candidate);
    return {
      rows: [...bySource.values()],
      configUpdate: {
        browserStorageState: await context.storageState(),
        sessionStatus: "connected",
        sessionRefreshedAt: new Date().toISOString(),
        sessionLastError: null,
        lastAgentMessage: `${displayName}: ${bySource.size} candidatos detectados.`
      },
      message: `${displayName}: ${visited.size} paginas revisadas, ${bySource.size} candidatos detectados.`
    };
  } finally {
    await browser.close().catch(() => null);
  }
}

async function scrapeBuscojobs(config: Record<string, unknown>) {
  const auth = authFromConfig(config);
  if (auth.authorization) {
    try {
      return await scrapeBuscojobsWithApi(config);
    } catch (error: any) {
      if (/sesion\/API de Buscojobs vencio|JWTExpired|INVALID_TOKEN/i.test(error?.message ?? "")) {
        const refreshedAuth = await loginBuscojobsApiWithCredentials(config);
        if (refreshedAuth) {
          const nextConfig = { ...config, ...refreshedAuth };
          try {
            const result = await scrapeBuscojobsWithApi(nextConfig, "Buscojobs: token vencido; se renovo con usuario/contrasena. ");
            return {
              ...result,
              configUpdate: refreshedAuth
            };
          } catch (nextError: any) {
            const fallback = await scrapeBuscojobsWithFallback(nextConfig, cleanText(nextError?.message), "Buscojobs: token renovado pero API de postulantes fallo. ");
            return {
              ...fallback,
              configUpdate: { ...refreshedAuth, ...fallback.configUpdate }
            };
          }
        }

        const refreshedCookies = await loginBuscojobsWithCredentials(config);
        if (refreshedCookies) {
          const result = await scrapeBuscojobsWithCookies(config, refreshedCookies, "Buscojobs: token API vencido; se reconecto con usuario/contrasena. ");
          return {
            ...result,
            configUpdate: {
              sessionCookies: refreshedCookies,
              sessionStatus: "connected",
              sessionRefreshedAt: new Date().toISOString(),
              sessionLastError: null
            }
          };
        }

        const browserResult = await scrapeBuscojobsWithBrowser(
          { ...config, apiKey: null, token: null, accessToken: null },
          "Buscojobs: token vencido; se intento navegador automatico. "
        );
        return {
          ...browserResult,
          configUpdate: {
            apiKey: null,
            token: null,
            accessToken: null,
            ...browserResult.configUpdate
          }
        };
      }
      return scrapeBuscojobsWithFallback(config, cleanText(error?.message));
    }
  }

  const refreshedAuth = await loginBuscojobsApiWithCredentials(config);
  if (refreshedAuth) {
    const nextConfig = { ...config, ...refreshedAuth };
    try {
      const result = await scrapeBuscojobsWithApi(nextConfig, "Buscojobs: se inicio sesion API con usuario/contrasena guardados. ");
      return {
        ...result,
        configUpdate: refreshedAuth
      };
    } catch (error: any) {
      const fallback = await scrapeBuscojobsWithFallback(nextConfig, cleanText(error?.message), "Buscojobs: login API funciono pero API de postulantes fallo. ");
      return {
        ...fallback,
        configUpdate: { ...refreshedAuth, ...fallback.configUpdate }
      };
    }
  }

  const cookieHeader = cookieHeaderFromConfig(config);
  if (cookieHeader) return scrapeBuscojobsWithCookies(config, cookieHeader);

  const refreshedCookies = await loginBuscojobsWithCredentials(config);
  if (refreshedCookies) {
    const result = await scrapeBuscojobsWithCookies(config, refreshedCookies, "Buscojobs: se inicio sesion con usuario/contrasena guardados. ");
    return {
      ...result,
      configUpdate: {
        sessionCookies: refreshedCookies,
        sessionStatus: "connected",
        sessionRefreshedAt: new Date().toISOString(),
        sessionLastError: null
      }
    };
  }

  return scrapeBuscojobsWithBrowser(config, "Buscojobs: API/login simple no funciono; se intento navegador automatico. ");
}

async function scrapeBuscojobsWithCookies(config: Record<string, unknown>, cookieHeader: string, prefix = "") {
  const panelHtml = await fetchBuscojobs("https://buscojobs.com.uy/app/empresa/panel", cookieHeader);
  const offerUrls = extractOfferLinks(panelHtml).slice(0, Number(config.maxOffers ?? 80));
  const allCandidates: CandidateImport[] = [];
  const notes: string[] = [];

  for (const offerUrl of offerUrls) {
    try {
      const offerHtml = await fetchBuscojobs(offerUrl, cookieHeader);
      const offerTitle = htmlText(offerHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "") || htmlText(offerHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
      const listUrls = candidateListUrls(offerUrl, offerHtml).slice(0, 4);
      let foundForOffer = 0;

      for (const listUrl of listUrls) {
        try {
          const listHtml = await fetchBuscojobs(listUrl, cookieHeader);
          const pageCandidates = extractCandidatesFromHtml(listHtml, listUrl, offerTitle);
          foundForOffer += pageCandidates.length;
          allCandidates.push(...pageCandidates);

          const paginationUrls = unique(extractLinks(listHtml, listUrl)
            .filter((link) => /pagina|page|p=\d+|offset|desde/i.test(link.url))
            .map((link) => link.url))
            .slice(0, Number(config.maxPagesPerOffer ?? 5));
          for (const pageUrl of paginationUrls) {
            const pageHtml = await fetchBuscojobs(pageUrl, cookieHeader);
            const extra = extractCandidatesFromHtml(pageHtml, pageUrl, offerTitle);
            foundForOffer += extra.length;
            allCandidates.push(...extra);
          }
        } catch {
          continue;
        }
      }

      notes.push(`${compactLabel(offerTitle, "Oferta Buscojobs") || "Oferta Buscojobs"}: ${foundForOffer}`);
    } catch {
      notes.push(`${offerUrl}: error`);
    }
  }

  const bySource = new Map<string, CandidateImport>();
  for (const candidate of allCandidates) bySource.set(candidate.sourceId ?? candidate.fullName, candidate);
  return {
    rows: [...bySource.values()],
    message: `${prefix}Buscojobs: ${offerUrls.length} ofertas revisadas, ${bySource.size} candidatos reales detectados. ${notes.slice(0, 6).join(" | ")}`
  };
}

const AGENTS: Record<string, SourceConnector> = {
  aglh: {
    id: "aglh",
    name: "AGLH Platform",
    sync: (config) => scrapeGenericWebSource("aglh", "AGLH Platform", config)
  },
  buscojobs: {
    id: "buscojobs",
    name: "Buscojobs",
    sync: scrapeBuscojobs
  },
  drive: {
    id: "drive",
    name: "Google Drive",
    sync: scrapeDrive
  },
  gmail: {
    id: "gmail",
    name: "Gmail",
    sync: scrapeGmail
  },
  yoiners: {
    id: "yoiners",
    name: "Yoiners",
    sync: (config) => scrapeGenericWebSource("yoiners", "Yoiners", config)
  }
};

function rowsFromConfig(config: Record<string, unknown>) {
  const direct = config.records ?? config.candidates;
  if (Array.isArray(direct)) {
    return direct.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
  }

  const raw = cleanText(config.historicalData ?? config.rawData ?? config.exportData);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
    }
    if (Array.isArray(parsed?.candidates)) {
      return parsed.candidates.filter((item: unknown): item is Record<string, unknown> => typeof item === "object" && item !== null);
    }
    if (Array.isArray(parsed?.records)) {
      return parsed.records.filter((item: unknown): item is Record<string, unknown> => typeof item === "object" && item !== null);
    }
    const nested = collectCandidateLikeRows(parsed);
    if (nested.length > 0) return nested;
  } catch {
    return parseCsv(raw);
  }

  return [];
}

function normalizeCandidate(row: Record<string, unknown>, sourceType: string): CandidateImport | null {
  const fullName = firstText(row, ["fullName", "full_name", "name", "nombre", "Nombre", "Nombre completo", "nombre completo", "Postulante", "postulante", "Candidato", "candidato", "Persona", "persona"]);
  const firstName = firstText(row, ["firstName", "first_name", "primerNombre", "PrimerNombre", "nombres", "Nombres", "nombre"]);
  const lastName = firstText(row, ["lastName", "last_name", "apellido", "Apellido", "apellidos", "Apellidos"]);
  const email = extractEmails(deepFirstText(row, ["email", "emails", "mail", "Mail", "correo", "Correo", "Correo electronico", "Email"]));
  const phone = extractPhones(deepFirstText(row, ["phone", "phones", "telefono", "Telefono", "teléfono", "Teléfono", "celular", "Celular", "mobile", "Mobile", "whatsapp", "WhatsApp"]));
  const resolvedName = fullName ?? unique([firstName ?? "", lastName ?? ""]).join(" ").trim();

  if (!resolvedName && email.length === 0 && phone.length === 0) return null;

  const yearsText = firstText(row, ["years", "yearsExperience", "experiencia_anios", "anos", "anios"]);
  const years = yearsText && Number.isFinite(Number(yearsText)) ? Number(yearsText) : null;

  return {
    fullName: resolvedName || email[0] || phone[0],
    firstName,
    lastName,
    email,
    phone,
    city: firstText(row, ["city", "ciudad", "location", "ubicacion"]),
    country: firstText(row, ["country", "pais"]),
    linkedinUrl: firstText(row, ["linkedinUrl", "linkedin_url", "linkedin"]),
    currentRole: compactLabel(firstText(row, ["currentRole", "current_role", "role", "cargo", "Cargo", "puesto", "Puesto", "position", "Postulacion", "postulacion", "Oferta", "oferta", "Vacante", "vacante"])),
    seniority: firstText(row, ["seniority", "seniorityLevel", "nivel"]),
    years,
    tags: safeTags(listFrom(row.tags ?? row.skills ?? row.habilidades ?? row.competencias ?? row.area ?? row.Area), sourceType),
    summary: firstText(row, ["summary", "resumen", "Resumen", "notes", "notas", "Notas", "experiencia", "Experiencia", "cvTexto", "textoCV"]),
    qualityScore: 0,
    sourceId: firstText(row, ["id", "Id", "sourceId", "source_id", "candidateId", "candidate_id", "PostulanteId", "postulanteId", "CandidatoId", "candidatoId", "PostulacionId", "postulacionId"]),
    sourceUrl: firstText(row, ["url", "sourceUrl", "source_url", "profileUrl", "profile_url"]),
    documents: candidateDocumentsFromRow(row, sourceType),
    raw: row
  };
}

async function ensureDefaultIntegrations() {
  for (const [id, name] of DEFAULT_INTEGRATIONS) {
    await q("INSERT INTO integrations (id, name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING", [id, name]);
  }
}

async function removeCookieCandidates() {
  await q(
    `DELETE FROM candidates
     WHERE EXISTS (
       SELECT 1 FROM candidate_sources cs
       WHERE cs.candidate_id = candidates.id
         AND cs.source_type = 'buscojobs'
         AND (
           cs.source_data ? 'domain'
           OR cs.source_data ? 'expirationDate'
           OR candidates.full_name IN ('_gads','_gpi','_eoi','isiframeenabled','buscojobs-_zldt','buscojobs-_zldp','_hjSession_1333623','_hjSessionUser_1333623')
         )
     )`
  );

}

async function markStaleSyncingIntegrations() {
  await q(
    `UPDATE integrations
     SET config = config || $1::jsonb,
         updated_at = now(),
         status = 'error'
     WHERE config->>'sessionStatus' = 'syncing'
       AND updated_at < now() - interval '3 minutes'`,
    [JSON.stringify({
      sessionStatus: "error",
      sessionLastError: "La sincronizacion quedo sin respuesta del servidor. Vuelve a intentar con una fuente por vez.",
      syncEngineVersion: SYNC_ENGINE_VERSION
    })]
  );
}

integrationsRouter.get("/", asyncHandler(async (_req, res) => {
  await ensureDefaultIntegrations();
  await removeCookieCandidates();
  await markStaleSyncingIntegrations();
  const [integrations, logs, rejected] = await Promise.all([
    q("SELECT * FROM integrations ORDER BY name"),
    q("SELECT * FROM sync_logs ORDER BY started_at DESC LIMIT 20"),
    q("SELECT source_type, extracted_name, reason, source_url, created_at FROM rejected_imports ORDER BY created_at DESC LIMIT 30")
  ]);
  res.json({
    data: integrations.rows.map((row) => ({ ...row, config: maskConfig(row.config) })),
    logs: logs.rows,
    rejected: rejected.rows,
    meta: { syncEngineVersion: SYNC_ENGINE_VERSION }
  });
}));

integrationsRouter.patch("/:id", requireRole("admin"), asyncHandler(async (req, res) => {
  const body = z.object({
    status: z.enum(["not_configured", "connected", "warning", "error", "soon"]).optional(),
    config: z.record(z.any()).optional()
  }).parse(req.body);
  const configToSave = prepareConfigForSave(String(req.params.id), body.config);
  const { rows } = await q(
    `INSERT INTO integrations (id, name, status, config)
     VALUES ($3,$4,coalesce($1,'connected'),coalesce($2::jsonb,'{}'::jsonb))
     ON CONFLICT (id) DO UPDATE SET
       status=coalesce($1,integrations.status),
       config=integrations.config || coalesce($2::jsonb,'{}'::jsonb),
       updated_at=now()
     RETURNING *`,
    [body.status, configToSave ? JSON.stringify(configToSave) : null, req.params.id, DEFAULT_INTEGRATIONS.find(([id]) => id === req.params.id)?.[1] ?? req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Integracion no encontrada" });
  res.json({ data: { ...rows[0], config: maskConfig(rows[0].config) } });
}));

integrationsPublicRouter.get("/google/callback", asyncHandler(async (req, res) => {
  const id = String(req.query.state ?? "");
  const code = cleanText(req.query.code);
  if ((id !== "gmail" && id !== "drive") || !code) {
    return res.status(400).send("<h1>TalentHub</h1><p>No se pudo conectar Google: falta codigo o fuente.</p>");
  }
  const current = await q("SELECT config FROM integrations WHERE id=$1", [id]);
  const config = current.rows[0]?.config ?? {};
  let update: Record<string, unknown>;
  try {
    update = await exchangeGoogleOAuthCode(id, config, code);
  } catch (error: any) {
    const message = cleanText(error?.message) || "No se pudo conectar Google.";
    await q(
      `INSERT INTO integrations (id, name, status, config)
       VALUES ($1,$2,'error',$3::jsonb)
       ON CONFLICT (id) DO UPDATE SET config=integrations.config || $3::jsonb, status='error', updated_at=now()`,
      [id, DEFAULT_INTEGRATIONS.find(([key]) => key === id)?.[1] ?? id, JSON.stringify({ oauthStatus: "error", sessionStatus: "requires_oauth", sessionLastError: message })]
    );
    return res
      .status(400)
      .type("html")
      .send(`<!doctype html><html><head><meta charset="utf-8"><title>TalentHub Google</title></head><body style="font-family:system-ui;padding:32px"><h1>No se pudo conectar Google</h1><p>${escapeHtml(message)}</p><p>Volvé a TalentHub, tocá Conectar Google y elegí la cuenta correcta.</p></body></html>`);
  }
  await q(
    `INSERT INTO integrations (id, name, status, config)
     VALUES ($1,$2,'connected',$3::jsonb)
     ON CONFLICT (id) DO UPDATE SET config=integrations.config || $3::jsonb, status='connected', updated_at=now()`,
    [id, DEFAULT_INTEGRATIONS.find(([key]) => key === id)?.[1] ?? id, JSON.stringify(update)]
  );
  res
    .status(200)
    .type("html")
    .send(`<!doctype html><html><head><meta charset="utf-8"><title>TalentHub conectado</title></head><body style="font-family:system-ui;padding:32px"><h1>Google conectado</h1><p>${id === "gmail" ? "Gmail" : "Google Drive"} quedo conectado en TalentHub. Ya podes volver a la app y sincronizar.</p></body></html>`);
}));

integrationsRouter.post("/:id/google-oauth-url", requireRole("admin"), asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  if (id !== "gmail" && id !== "drive") return res.status(400).json({ error: "OAuth de Google solo aplica a Gmail o Drive." });
  const body = z.object({
    clientId: z.string().min(1),
    clientSecret: z.string().optional(),
    redirectUri: z.string().optional(),
    expectedGoogleEmail: z.string().optional()
  }).parse(req.body);
  const current = await q("SELECT config FROM integrations WHERE id=$1", [id]);
  const config = { ...(current.rows[0]?.config ?? {}), ...body };
  const url = googleOAuthUrl(id, config);
  const redirectUri = googleRedirectUri(config);
  await q(
    `INSERT INTO integrations (id, name, status, config)
     VALUES ($1,$2,'warning',$3::jsonb)
     ON CONFLICT (id) DO UPDATE SET config=integrations.config || $3::jsonb, status='warning', updated_at=now()`,
    [id, DEFAULT_INTEGRATIONS.find(([key]) => key === id)?.[1] ?? id, JSON.stringify({ clientId: body.clientId, clientSecret: body.clientSecret, redirectUri: body.redirectUri, expectedGoogleEmail: body.expectedGoogleEmail, oauthStatus: "waiting_code" })]
  );
  res.json({ data: { url, redirectUri } });
}));

integrationsRouter.post("/:id/google-oauth-code", requireRole("admin"), asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  if (id !== "gmail" && id !== "drive") return res.status(400).json({ error: "OAuth de Google solo aplica a Gmail o Drive." });
  const body = z.object({
    code: z.string().min(4),
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    redirectUri: z.string().optional(),
    expectedGoogleEmail: z.string().optional()
  }).parse(req.body);
  const current = await q("SELECT config FROM integrations WHERE id=$1", [id]);
  const config = { ...(current.rows[0]?.config ?? {}), ...body };
  const update = await exchangeGoogleOAuthCode(id, config, body.code.trim());
  await q(
    `INSERT INTO integrations (id, name, status, config)
     VALUES ($1,$2,'connected',$3::jsonb)
     ON CONFLICT (id) DO UPDATE SET config=integrations.config || $3::jsonb, status='connected', updated_at=now()`,
    [id, DEFAULT_INTEGRATIONS.find(([key]) => key === id)?.[1] ?? id, JSON.stringify(update)]
  );
  res.json({ data: { status: "connected", message: update.lastAgentMessage } });
}));

async function syncIntegration(integrationId: string) {
  const integration = await q("SELECT * FROM integrations WHERE id=$1", [integrationId]);
  if (!integration.rowCount) return null;

  const started = Date.now();
  const config = integration.rows[0].config ?? {};
  const hasConfig = Object.values(config).some((value) => String(value ?? "").trim().length > 0);
  const agent = AGENTS[integrationId];
  let scraperResult: AgentSyncResult | null = null;
  let scraperError: string | null = null;
  if (agent) {
    await q(
      "UPDATE integrations SET config=config || $1::jsonb, updated_at=now() WHERE id=$2",
      [JSON.stringify({
        sessionStatus: "syncing",
        sessionLastError: null,
        lastAgentMessage: `${agent.name}: sincronizando con motor ${SYNC_ENGINE_VERSION}.`,
        syncEngineVersion: SYNC_ENGINE_VERSION
      }), integrationId]
    );
    try {
      scraperResult = await withTimeout(
        agent.sync(config),
        numberFromConfig(config.syncTimeoutMs, 70_000),
        `${agent.name} no respondio a tiempo. Proba sincronizar esa fuente sola o vuelve a guardar la sesion.`
      );
      if (scraperResult.configUpdate) {
        await q(
          "UPDATE integrations SET config=config || $1::jsonb, updated_at=now() WHERE id=$2",
          [JSON.stringify({ syncEngineVersion: SYNC_ENGINE_VERSION, ...scraperResult.configUpdate }), integrationId]
        );
      }
    } catch (error: any) {
      scraperError = error?.message ?? `Error desconocido leyendo ${agent.name}.`;
      await q(
        "UPDATE integrations SET config=config || $1::jsonb, updated_at=now() WHERE id=$2",
        [JSON.stringify({ sessionStatus: "error", sessionLastError: scraperError, sessionFailedAt: new Date().toISOString(), syncEngineVersion: SYNC_ENGINE_VERSION }), integrationId]
      );
    }
  }
  const rowsToImport = scraperResult?.rows ?? rowsFromConfig(config);
  let status = integration.rows[0].status === "connected" && hasConfig ? "warning" : "error";
  let message = status === "warning"
    ? "Credenciales guardadas. Para traer historico ahora, pega un exportado JSON o CSV en Datos historicos y volve a sincronizar."
    : "La integracion necesita estado Conectado y al menos una credencial, sesion o exportado guardado.";
  let newRecords = 0;
  let updatedRecords = 0;
  let errors = 0;

  if (rowsToImport.length > 0) {
    for (const row of rowsToImport) {
      const candidate = scraperResult && isAgentCandidate(row)
        ? row
        : integrationId === "buscojobs"
          ? (applicantFromRow(row as Record<string, unknown>, {}) ?? normalizeCandidate(row as Record<string, unknown>, integrationId))
          : normalizeCandidate(row as Record<string, unknown>, integrationId);
      if (!candidate) {
        errors += 1;
        continue;
      }
      const result = await importCandidate(integrationId, candidate, isUsableCandidate);
      if (result === "new") newRecords += 1;
      if (result === "updated") updatedRecords += 1;
      if (result === "skipped") errors += 1;
    }
    const savedRecords = newRecords + updatedRecords;
    status = savedRecords > 0 ? (errors > 0 ? "warning" : "success") : (errors > 0 ? "error" : "warning");
    message = scraperResult?.message
      ? `${scraperResult.message} Importados: ${newRecords} nuevos, ${updatedRecords} actualizados, ${errors} omitidos.`
      : `Historico procesado: ${newRecords} nuevos, ${updatedRecords} actualizados, ${errors} omitidos.`;
  } else if (scraperResult) {
    message = scraperResult.message;
    if (/^requires_/i.test(cleanText(scraperResult.configUpdate?.sessionStatus))) {
      status = "error";
      errors = 1;
    }
  } else if (scraperError) {
    status = "error";
    errors = 1;
    message = `${agent?.name ?? integration.rows[0].name} no pudo sincronizar: ${scraperError}`;
  }

  if (scraperResult?.message) {
    const resultStatus = status === "error" ? cleanText(scraperResult.configUpdate?.sessionStatus) || "error" : "connected";
    await q(
      "UPDATE integrations SET config=config || $1::jsonb, updated_at=now() WHERE id=$2",
      [JSON.stringify({
        sessionStatus: resultStatus,
        sessionLastError: status === "error" ? (scraperResult.configUpdate?.sessionLastError ?? scraperResult.message) : null,
        lastAgentMessage: message,
        syncEngineVersion: SYNC_ENGINE_VERSION
      }), integrationId]
    );
  }

  await q(
    `INSERT INTO agent_runs (agent_id, run_type, status, finished_at, records_found, records_imported, errors, message, metadata)
     VALUES ($1,'sync',$2,now(),$3,$4,$5,$6,$7::jsonb)`,
    [
      integrationId,
      status,
      rowsToImport.length,
      newRecords + updatedRecords,
      errors,
      message,
      JSON.stringify({ hasConfig, source: integration.rows[0].name })
    ]
  );

  const { rows } = await q(
    "INSERT INTO sync_logs (integration_id, source, finished_at, duration_ms, status, new_records, updated_records, errors, message) VALUES ($1,$2,now(),$3,$4,$5,$6,$7,$8) RETURNING *",
    [integrationId, integration.rows[0].name, Date.now() - started, status, newRecords, updatedRecords, errors, message]
  );
  await q(
    "UPDATE integrations SET last_sync_at=now(), total_imported=total_imported+$1, updated_at=now(), status=$2 WHERE id=$3",
    [newRecords + updatedRecords, status === "error" ? "error" : "connected", integrationId]
  );
  return rows[0];
}

export async function syncConnectedIntegrations() {
  await ensureDefaultIntegrations();
  const integrations = await q<{ id: string }>(
    `SELECT id FROM integrations
     WHERE status NOT IN ('not_configured','soon')
       AND config <> '{}'::jsonb
     ORDER BY name`
  );
  const results = await runSyncQueue(integrations.rows, 2, async (row) => {
    try {
      return await syncIntegration(row.id);
    } catch (err) {
      console.error(`sync-all failed for ${row.id}`, err);
      return null;
    }
  });
  return results.filter(Boolean);
}

async function runSyncQueue<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
  const results: R[] = [];
  let index = 0;
  async function runNext() {
    while (index < items.length) {
      const current = items[index++];
      results.push(await worker(current));
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, runNext);
  await Promise.all(workers);
  return results;
}

integrationsRouter.post("/sync-all", requireRole("recruiter"), asyncHandler(async (_req, res) => {
  const results = await syncConnectedIntegrations();
  const imported = results.reduce((sum, row: any) => sum + Number(row.new_records ?? 0) + Number(row.updated_records ?? 0), 0);
  const errors = results.reduce((sum, row: any) => sum + Number(row.errors ?? 0), 0);
  res.status(201).json({
    data: results,
    meta: {
      sources: results.length,
      imported,
      errors,
      message: `Fuentes actualizadas: ${results.length}. Registros importados/actualizados: ${imported}. Errores u omitidos: ${errors}.`
    }
  });
}));

integrationsRouter.post("/gmail/backfill-start", requireRole("recruiter"), asyncHandler(async (_req, res) => {
  await ensureDefaultIntegrations();
  await q(
    `UPDATE integrations
     SET config =
       (
         coalesce(config, '{}'::jsonb)
         - 'gmailBackfillCompleteAt'
         - 'gmailLastIncrementalSyncAt'
         - 'gmailIncrementalSince'
         - 'gmailQuery'
         - 'gmailNextPageToken'
         - 'gmailPendingMessageIds'
         - 'gmailHasMore'
         - 'gmailSyncMode'
         - 'gmailHistoryId'
         - 'gmailHistoryStartId'
         - 'gmailHistoryTargetId'
         - 'gmailHistoryNextPageToken'
         - 'gmailHistorySyncActive'
         - 'gmailHistorySeedId'
       ) || $1::jsonb,
       status='connected',
       updated_at=now()
     WHERE id='gmail'`,
    [JSON.stringify({
      gmailHistoricalStartedAt: new Date().toISOString(),
      sessionStatus: "syncing",
      sessionLastError: null,
      lastAgentMessage: "Gmail: iniciando migracion historica completa."
    })]
  );
  const result = await syncIntegration("gmail");
  if (!result) return res.status(404).json({ error: "Integracion Gmail no encontrada" });
  res.status(201).json({ data: result });
}));

integrationsRouter.post("/gmail/takeout-import", requireRole("recruiter"), express.raw({ type: ["application/octet-stream", "application/mbox", "application/zip", "text/plain"], limit: "300mb" }), asyncHandler(async (req, res) => {
  const started = Date.now();
  const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
  if (buffer.length < 20) return res.status(400).json({ error: "Subi un archivo .zip o .mbox exportado desde Google Takeout." });
  const fileName = cleanText(req.query.fileName) || "gmail-takeout.mbox";
  const parsed = await candidatesFromGmailTakeoutArchive(buffer, fileName);
  let newRecords = 0;
  let updatedRecords = 0;
  let skipped = parsed.stats.skipped;
  for (const candidate of parsed.rows) {
    const result = await importCandidate("gmail", candidate, isUsableCandidate);
    if (result === "new") newRecords += 1;
    if (result === "updated") updatedRecords += 1;
    if (result === "skipped") skipped += 1;
  }
  const zipDetail = "mboxFiles" in parsed.stats ? `, ${parsed.stats.mboxFiles} archivos mbox` : "";
  const takeoutCompletedAt = new Date().toISOString();
  const message = `Gmail Takeout: ${parsed.stats.messages} mails revisados${zipDetail}, ${parsed.stats.reviewedAttachments} adjuntos revisados, ${parsed.stats.candidateAttachments} CVs detectados. Importados: ${newRecords} nuevos, ${updatedRecords} actualizados, ${skipped} omitidos.`;
  await q(
    "INSERT INTO sync_logs (integration_id, source, finished_at, duration_ms, status, new_records, updated_records, errors, message) VALUES ('gmail','Gmail Takeout',now(),$1,$2,$3,$4,$5,$6) RETURNING *",
    [Date.now() - started, skipped > 0 ? "warning" : "success", newRecords, updatedRecords, skipped, message]
  );
  await q(
    "UPDATE integrations SET last_sync_at=now(), total_imported=total_imported+$1, status='connected', config=config || $2::jsonb, updated_at=now() WHERE id='gmail'",
    [newRecords + updatedRecords, JSON.stringify({
      sessionStatus: "connected",
      sessionLastError: null,
      lastAgentMessage: message,
      gmailTakeoutImportedAt: new Date().toISOString(),
      gmailTakeoutLastFile: fileName,
      gmailBackfillCompleteAt: takeoutCompletedAt,
      gmailPendingMessageIds: [],
      gmailNextPageToken: null,
      gmailHasMore: false,
      gmailSyncMode: "incremental",
      gmailHistoryId: null,
      gmailHistoryStartId: null,
      gmailHistoryTargetId: null,
      gmailHistoryNextPageToken: null,
      gmailHistorySeedId: null,
      syncEngineVersion: SYNC_ENGINE_VERSION
    })]
  );
  res.status(201).json({
    data: {
      newRecords,
      updatedRecords,
      skipped,
      message,
      stats: parsed.stats
    }
  });
}));

integrationsRouter.post("/:id/sync", requireRole("recruiter"), asyncHandler(async (req, res) => {
  const result = await syncIntegration(String(req.params.id));
  if (!result) return res.status(404).json({ error: "Integracion no encontrada" });
  res.status(201).json({ data: result });
}));
