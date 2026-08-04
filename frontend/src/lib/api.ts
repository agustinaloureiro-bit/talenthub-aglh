export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";

export type User = { id: string; name: string; email: string; role: "admin" | "recruiter" | "viewer"; avatarUrl?: string | null };

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

type ApiRequestOptions = RequestInit & { timeoutMs?: number };

export async function api<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(options.headers as Record<string, string> | undefined) };
  const controller = options.signal ? null : new AbortController();
  const timeout = controller && options.timeoutMs ? window.setTimeout(() => controller.abort(), options.timeoutMs) : null;
  const { timeoutMs: _timeoutMs, ...fetchOptions } = options;
  try {
    const response = await fetch(`${API_URL}${path}`, { ...fetchOptions, headers, credentials: "include", signal: options.signal ?? controller?.signal });
    if (response.status === 204) return undefined as T;
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401 && path !== "/auth/me") {
      sessionStorage.removeItem("talenthub:finder-state:v2");
      window.location.assign("/login");
    }
    if (!response.ok) throw new ApiError(payload.error ?? "Error de API", response.status);
    return payload as T;
  } catch (error: any) {
    if (error?.name === "AbortError") throw new ApiError("La búsqueda demoró demasiado. Probá nuevamente con un criterio más específico.", 408);
    throw error;
  } finally {
    if (timeout) window.clearTimeout(timeout);
  }
}

export function authHeaders(): Record<string, string> {
  return {};
}

export function loginWithGoogle() {
  window.location.assign(`${API_URL}/auth/google`);
}

export async function loadCurrentUser() {
  return (await api<{ user: User }>("/auth/me")).user;
}

export async function logout() {
  await api<void>("/auth/logout", { method: "POST" });
}
