// Nexley Mobile prototype — shared API client.
//
// All screens that need real data go through nexleyApi.* helpers. The
// helpers read JWT + apiBase from localStorage (set in the Settings
// screen). When JWT is empty, the helpers throw a special MockMode error
// so the screens know to fall back to NX_MOCK data.

(function () {
  function getAuth() {
    if (typeof window === 'undefined') return { jwt: null, apiBase: '' };
    return {
      jwt: window.localStorage.getItem('nexley_jwt') || null,
      apiBase: window.localStorage.getItem('nexley_api_base') || window.location.origin,
    };
  }

  class MockMode extends Error {
    constructor() { super('mock_mode'); this.name = 'MockMode'; }
  }
  class ApiError extends Error {
    constructor(status, body) { super(body?.message || `HTTP ${status}`); this.status = status; this.body = body; }
  }

  async function request(path, opts = {}) {
    const { jwt, apiBase } = getAuth();
    if (!jwt) throw new MockMode();
    const url = apiBase.replace(/\/$/, '') + path;
    const res = await fetch(url, {
      ...opts,
      headers: {
        Authorization: `Bearer ${jwt}`,
        ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...opts.headers,
      },
    });
    if (!res.ok) {
      let body = null;
      try { body = await res.json(); } catch {}
      throw new ApiError(res.status, body);
    }
    if (res.headers.get('content-type')?.includes('application/json')) {
      return res.json();
    }
    return null;
  }

  const nexleyApi = {
    isLive: () => !!getAuth().jwt,
    MockMode,
    ApiError,

    // Auth + me
    me: () => request('/api/mobile/me'),

    // Chat with AI Employee
    chatSend: (body, idempotencyKey) => request('/api/mobile/chat/send', {
      method: 'POST',
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
      body: JSON.stringify(body),
    }),
    // DA fix E16: get a short-lived ticket from /api/mobile/chat/stream-ticket
    // and use it as ?ticket= on the SSE EventSource. Avoids leaking the JWT
    // in URL logs / browser history / proxies.
    chatStreamUrl: async (conversationId, assistantMessageId) => {
      const { apiBase } = getAuth();
      const ticketResp = await request('/api/mobile/chat/stream-ticket', {
        method: 'POST',
        body: JSON.stringify({
          conversation_id: conversationId,
          assistant_message_id: assistantMessageId,
        }),
      });
      return `${apiBase}/api/chat/stream/${conversationId}?ticket=${encodeURIComponent(ticketResp.ticket)}&assistant_message_id=${encodeURIComponent(assistantMessageId)}`;
    },

    // Inbox
    inboxList: (filter = 'all') => request(`/api/mobile/inbox?filter=${filter}`),
    inboxDetail: (id) => request(`/api/mobile/inbox/${id}`),
    inboxTakeOver: (id) => request(`/api/mobile/inbox/${id}/take-over`, { method: 'POST', body: '{}' }),
    inboxHandBack: (id) => request(`/api/mobile/inbox/${id}/hand-back`, { method: 'POST', body: '{}' }),
    inboxSend: (id, content) => request(`/api/mobile/inbox/${id}/send`, {
      method: 'POST',
      headers: { 'Idempotency-Key': `inbox-send-${id}-${Date.now()}` },
      body: JSON.stringify({ content }),
    }),
    inboxMarkRead: (id) => request(`/api/mobile/inbox/${id}/mark-read`, { method: 'POST', body: '{}' }),

    // Contacts / jobs / estimates
    contacts: (search = '') => request(`/api/mobile/contacts${search ? `?search=${encodeURIComponent(search)}` : ''}`),
    jobs: () => request('/api/mobile/jobs'),
    estimates: () => request('/api/mobile/estimates'),

    // Integrations
    integrations: () => request('/api/mobile/integrations'),
    integrationConnect: (provider) => request(`/api/mobile/integrations/${provider}/connect`, { method: 'POST', body: '{}' }),
    integrationDisconnect: (provider) => request(`/api/mobile/integrations/${provider}/disconnect`, { method: 'POST', body: '{}' }),

    // AI Employee config
    aiEmployee: () => request('/api/mobile/ai-employee'),
    aiEmployeePatch: (body) => request('/api/mobile/ai-employee', { method: 'PATCH', body: JSON.stringify(body) }),

    // Notifications
    notifications: () => request('/api/mobile/notifications'),
    notificationPreferences: () => request('/api/mobile/notifications/preferences'),
  };

  // Tiny React hook for screens: useLiveOrMock(loader, mockData)
  // Returns { data, loading, error, isLive }. Screens call this with a
  // function that hits nexleyApi.* and a fallback NX_MOCK object.
  function useLiveOrMock(loader, mockData) {
    const [state, setState] = React.useState({ data: null, loading: true, error: null, isLive: false });
    React.useEffect(() => {
      let cancelled = false;
      (async () => {
        try {
          const data = await loader();
          if (!cancelled) setState({ data, loading: false, error: null, isLive: true });
        } catch (err) {
          if (cancelled) return;
          if (err instanceof MockMode) {
            setState({ data: mockData, loading: false, error: null, isLive: false });
          } else {
            setState({ data: mockData, loading: false, error: err.message, isLive: false });
          }
        }
      })();
      return () => { cancelled = true; };
    }, []);
    return state;
  }

  Object.assign(window, { nexleyApi, useLiveOrMock });
})();
