import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from '../lib/api.js';

// Helper to set document.cookie
function setCookie(name: string, value: string) {
  Object.defineProperty(document, 'cookie', {
    writable: true,
    value: `${name}=${value}`,
  });
}

function clearCookie() {
  Object.defineProperty(document, 'cookie', {
    writable: true,
    value: '',
  });
}

describe('api client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    clearCookie();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeResponse(body: unknown, status = 200) {
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      text: () => Promise.resolve(JSON.stringify(body)),
    } as Response);
  }

  it('apiGet sends credentials:include', async () => {
    fetchMock.mockReturnValue(makeResponse({ ok: true }));
    await apiGet('/api/test');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe('include');
    expect(init.method).toBe('GET');
  });

  it('apiGet does NOT send X-CSRF-Token', async () => {
    setCookie('xci_csrf', 'tok123');
    fetchMock.mockReturnValue(makeResponse({ ok: true }));
    await apiGet('/api/test');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-CSRF-Token']).toBeUndefined();
  });

  it('apiPost attaches X-CSRF-Token when xci_csrf cookie present', async () => {
    setCookie('xci_csrf', 'my-csrf-token');
    fetchMock.mockReturnValue(makeResponse({ ok: true }));
    await apiPost('/api/test', { foo: 'bar' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-CSRF-Token']).toBe('my-csrf-token');
  });

  it('throws ApiError with correct status on 4xx', async () => {
    fetchMock.mockReturnValue(makeResponse({ error: 'NOT_FOUND', message: 'Not found' }, 404));
    await expect(apiGet('/api/missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('throws ApiError with code AUTH_REQUIRED on 401', async () => {
    fetchMock.mockReturnValue(
      makeResponse({ error: 'AUTH_REQUIRED', message: 'Unauthorized' }, 401),
    );
    await expect(apiGet('/api/protected')).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
      status: 401,
    });
  });

  it('throws ApiError with code NETWORK_ERROR on fetch failure', async () => {
    fetchMock.mockRejectedValue(new Error('Failed to fetch'));
    await expect(apiGet('/api/test')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      status: 0,
    });
  });

  it('apiPost serializes body as JSON', async () => {
    fetchMock.mockReturnValue(makeResponse({ ok: true }));
    await apiPost('/api/test', { key: 'value' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({ key: 'value' }));
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('apiDelete sends DELETE method with credentials', async () => {
    fetchMock.mockReturnValue(makeResponse(null));
    await apiDelete('/api/resource/1');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('DELETE');
    expect(init.credentials).toBe('include');
  });

  it('apiPatch sends PATCH method', async () => {
    fetchMock.mockReturnValue(makeResponse({ ok: true }));
    await apiPatch('/api/resource/1', { name: 'updated' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('PATCH');
  });

  it('ApiError is instance of Error', () => {
    const err = new ApiError('TEST', 500, 'test error');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.name).toBe('ApiError');
  });
});
