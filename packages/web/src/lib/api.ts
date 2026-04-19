import { readCookie } from './utils.js';

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && method !== 'HEAD') {
    const csrf = readCookie('xci_csrf');
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    throw new ApiError('NETWORK_ERROR', 0, (err as Error).message);
  }
  const text = await res.text();
  const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  if (!res.ok) {
    if (res.status === 401) {
      // Caller (loader or hook) handles auth store clearing
      throw new ApiError(
        (parsed?.error as string | undefined) ?? 'AUTH_REQUIRED',
        res.status,
        (parsed?.message as string | undefined) ?? res.statusText,
        parsed,
      );
    }
    throw new ApiError(
      (parsed?.error as string | undefined) ?? 'HTTP_ERROR',
      res.status,
      (parsed?.message as string | undefined) ?? res.statusText,
      parsed,
    );
  }
  return parsed as T;
}

export const apiGet = <T>(url: string) => request<T>('GET', url);
export const apiPost = <T>(url: string, body?: unknown) => request<T>('POST', url, body);
export const apiPatch = <T>(url: string, body?: unknown) => request<T>('PATCH', url, body);
export const apiDelete = <T>(url: string) => request<T>('DELETE', url);
