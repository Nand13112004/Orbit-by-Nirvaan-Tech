const API_URL = process.env.NODE_ENV === 'production' ? '/api' : 'http://localhost:4000/api';
let csrfTokenCache: { value: string; createdAt: number } | undefined;
let csrfTokenRequest: Promise<string> | undefined;
let csrfTokenGeneration = 0;
const inFlightGetRequests = new Map<string, Promise<unknown>>();

export type ApiPerformanceMetric = {
  path: string;
  method: string;
  durationMs: number;
  controllerDurationMs?: number;
  status: number;
};

export type ApiResult<T> = { data: T; headers: Headers };

export async function apiWithMetadata<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  const method = (init.method ?? 'GET').toUpperCase();
  const measure = process.env.NODE_ENV === 'development';
  const startedAt = measure ? performance.now() : 0;
  let status = 0;
  let controllerDurationMs: number | undefined;
  try {
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...init.headers },
    });
    status = response.status;
    const timing = response.headers.get('server-timing')?.match(/(?:^|,)\s*controller;dur=([\d.]+)/);
    if (timing) controllerDurationMs = Number(timing[1]);
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { message?: string } | null;
      throw new Error(body?.message ?? `Request failed (${response.status})`);
    }
    return { data: await response.json() as T, headers: new Headers(response.headers) };
  } finally {
    if (measure) {
      console.debug('[api timing]', {
        path: path.split('?')[0], method,
        durationMs: Number((performance.now() - startedAt).toFixed(2)),
        ...(controllerDurationMs === undefined ? {} : { controllerDurationMs }), status,
      });
    }
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  // CSRF refreshes must reach the server even if an older token request is in flight.
  if (method === 'GET' && path !== '/auth/csrf') {
    const headers = new Headers(init.headers);
    const headerParts: string[] = [];
    headers.forEach((value, key) => headerParts.push(`${key}:${value}`));
    headerParts.sort();
    const requestKey = `${path}:${headerParts.join('|')}`;
    const existingRequest = inFlightGetRequests.get(requestKey);
    if (existingRequest) return existingRequest as Promise<T>;

    const request = executeApi<T>(path, init, method).finally(() => {
      inFlightGetRequests.delete(requestKey);
    });
    inFlightGetRequests.set(requestKey, request);
    return request;
  }

  return executeApi<T>(path, init, method);
}

async function executeApi<T>(path: string, init: RequestInit, method: string): Promise<T> {
  const measure = process.env.NODE_ENV === 'development';
  const startedAt = measure ? performance.now() : 0;
  let status = 0;
  let controllerDurationMs: number | undefined;

  try {
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...init.headers },
    });
    status = response.status;
    const controllerDuration = response.headers.get('server-timing')?.match(/(?:^|,)\s*controller;dur=([\d.]+)/);
    if (controllerDuration) controllerDurationMs = Number(controllerDuration[1]);
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { message?: string } | null;
      throw new Error(body?.message ?? `Request failed (${response.status})`);
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  } finally {
    if (measure) {
      const metric: ApiPerformanceMetric = {
        path: path.split('?')[0],
        method,
        durationMs: Number((performance.now() - startedAt).toFixed(2)),
        ...(controllerDurationMs === undefined ? {} : { controllerDurationMs }),
        status,
      };
      console.debug('[api timing]', metric);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent<ApiPerformanceMetric>('api:performance', { detail: metric }));
      }
    }
  }
}

export function getCsrfToken(): Promise<string> {
  if (csrfTokenCache && Date.now() - csrfTokenCache.createdAt < 5 * 60_000) {
    return Promise.resolve(csrfTokenCache.value);
  }
  if (csrfTokenRequest) return csrfTokenRequest;

  const generation = csrfTokenGeneration;
  const request = api<{ csrfToken: string }>('/auth/csrf', { cache: 'no-store' })
    .then((result) => {
      if (generation === csrfTokenGeneration) {
        csrfTokenCache = { value: result.csrfToken, createdAt: Date.now() };
      }
      return result.csrfToken;
    })
    .finally(() => {
      if (generation === csrfTokenGeneration) csrfTokenRequest = undefined;
    });
  csrfTokenRequest = request;
  return request;
}

export function clearCsrfToken() {
  csrfTokenCache = undefined;
  csrfTokenRequest = undefined;
  csrfTokenGeneration += 1;
}

export async function mutate<T>(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) {
  const requestBody = body === undefined ? undefined : JSON.stringify(body);
  const send = (csrf: string) => api<T>(path, {
    method,
    headers: { 'x-csrf-token': csrf },
    ...(requestBody === undefined ? {} : { body: requestBody }),
  });

  try {
    return await send(await getCsrfToken());
  } catch (error) {
    if (!(error instanceof Error) || !/invalid csrf token/i.test(error.message)) throw error;

    // A server-side session rotation or expired cookie can invalidate the
    // cached pair. Refresh once and retry only this explicit CSRF rejection.
    clearCsrfToken();
    return send(await getCsrfToken());
  }
}

export async function streamChat(
  messages: { role: 'user' | 'assistant'; content: string }[],
  onToken: (token: string) => void,
) {
  const body = JSON.stringify({ messages });

  async function send(csrf: string) {
    const response = await fetch(`${API_URL}/chat`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let message = `Request failed (${response.status})`;
      try {
        const errorBody = JSON.parse(errorText) as { message?: string | string[] };
        if (typeof errorBody.message === 'string') message = errorBody.message;
        if (Array.isArray(errorBody.message)) message = errorBody.message.join(', ');
      } catch {
        if (errorText) message = errorText;
      }
      throw new Error(message);
    }

    if (!response.body) throw new Error('The chat stream is unavailable. Please try again.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finished = false;
    let receivedToken = false;

    function processFrame(frame: string) {
      let eventName = 'message';
      const data: string[] = [];
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      if (eventName === 'error') {
        const parsed = JSON.parse(data.join('\n')) as { message?: string };
        throw new Error(parsed.message ?? 'The AI response was interrupted. Please try again.');
      }
      const payload = data.join('\n');
      if (!payload || payload === '[DONE]') {
        if (payload === '[DONE]') finished = true;
        return;
      }
      const parsed = JSON.parse(payload) as {
        choices?: { delta?: { content?: unknown } }[];
      };
      const token = parsed.choices?.[0]?.delta?.content;
      if (typeof token === 'string' && token) {
        receivedToken = true;
        onToken(token);
      }
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? '';
        for (const frame of frames) processFrame(frame);
        if (done) break;
      }
      if (buffer.trim()) processFrame(buffer);
    } finally {
      reader.releaseLock();
    }

    if (!finished || !receivedToken) {
      throw new Error('The AI response ended unexpectedly. Please try again.');
    }
  }

  try {
    await send(await getCsrfToken());
  } catch (error) {
    if (!(error instanceof Error) || !/invalid csrf token/i.test(error.message)) throw error;
    clearCsrfToken();
    await send(await getCsrfToken());
  }
}

export function dashboardForRole(role: string) {
  if (role === 'ADMIN') return '/dashboard/admin';
  if (role === 'MANAGER') return '/dashboard/manager';
  if (role === 'MEMBER') return '/dashboard/team-member';
  return '/';
}
