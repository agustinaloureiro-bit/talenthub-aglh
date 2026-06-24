const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";

export type User = { id: string; name: string; email: string; role: "admin" | "recruiter" | "viewer" };

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem("talenthub_token");
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(options.headers as Record<string, string> | undefined) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(payload.error ?? "Error de API", response.status);
  return payload as T;
}

export async function login(email: string, password: string) {
  const payload = await api<{ token: string; user: User }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  localStorage.setItem("talenthub_token", payload.token);
  localStorage.setItem("talenthub_user", JSON.stringify(payload.user));
  return payload.user;
}

export function currentUser(): User | null {
  const raw = localStorage.getItem("talenthub_user");
  return raw ? JSON.parse(raw) : null;
}

export function logout() {
  localStorage.removeItem("talenthub_token");
  localStorage.removeItem("talenthub_user");
}
