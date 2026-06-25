import { Router } from "express";
import { z } from "zod";
import { q } from "../db/pool.js";
import { asyncHandler } from "../middleware/errors.js";
import { requireRole } from "../middleware/auth.js";

export const integrationsRouter = Router();

const DEFAULT_INTEGRATIONS = [
  ["aglh", "AGLH Platform"],
  ["yoiners", "Yoiners"],
  ["buscojobs", "Buscojobs"],
  ["gmail", "Gmail"],
  ["drive", "Google Drive"],
  ["linkedin", "LinkedIn Recruiter"]
] as const;

type CandidateImport = {
  fullName: string;
  firstName?: string | null;
  lastName?: string | null;
  email: string[];
  phone: string[];
  city?: string | null;
  country?: string | null;
  linkedinUrl?: string | null;
  currentRole?: string | null;
  seniority?: string | null;
  years?: number | null;
  tags: string[];
  summary?: string | null;
  qualityScore: number;
  sourceId?: string | null;
  sourceUrl?: string | null;
  raw: Record<string, unknown>;
};

function maskConfig(config: Record<string, unknown> | null) {
  if (!config) return {};
  const masked = { ...config };
  for (const key of Object.keys(masked)) {
    if (/password|token|secret|cookie|session|key/i.test(key) && masked[key]) {
      masked[key] = "********";
    }
  }
  return masked;
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
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

function listFrom(value: unknown) {
