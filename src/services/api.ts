export async function apiRequest<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const token = localStorage.getItem('nexora_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const resp = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  const text = await resp.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text };
  }

  if (!resp.ok) {
    throw new Error(String(data.error || `Request failed (${resp.status})`));
  }

  return data as T;
}

export function createTradingSocket(onEvent: (event: string, payload: unknown) => void): () => void {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = localStorage.getItem('nexora_token') || '';
  const wsUrl = `${proto}//${window.location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;

  let socket: WebSocket | null = null;
  let closed = false;
  let reconnectTimer: number | null = null;

  const connect = () => {
    if (closed) return;
    socket = new WebSocket(wsUrl);
    socket.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data) as { event: string; payload: unknown };
        if (parsed.event) onEvent(parsed.event, parsed.payload);
      } catch {
        // Ignore malformed frame
      }
    };
    socket.onclose = () => {
      if (!closed) {
        reconnectTimer = window.setTimeout(connect, 4000);
      }
    };
  };

  connect();

  return () => {
    closed = true;
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close();
    }
  };
}
