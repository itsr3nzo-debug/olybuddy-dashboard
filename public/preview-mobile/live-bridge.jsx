// Nexley Mobile prototype — live data bridge.
//
// Strategy: existing screens read from window.NX_MOCK synchronously. To wire
// them to the real backend without rewriting every screen, we fetch live
// data on app mount and overwrite NX_MOCK with the response (shape-mapped
// to match the existing mock structure).
//
// When JWT is empty (mock mode), we leave NX_MOCK alone — the existing
// hardcoded data renders.
//
// Hook into the app via the React component <LiveBridge /> rendered at the
// root of the Prototype. It's invisible — only side-effects.

(function () {
  function LiveBridge() {
    const [status, setStatus] = React.useState('idle'); // 'idle' | 'fetching' | 'live' | 'mock' | 'error'
    const [error, setError] = React.useState(null);

    React.useEffect(() => {
      let cancelled = false;
      (async () => {
        if (!window.nexleyApi) return;
        if (!window.nexleyApi.isLive()) {
          setStatus('mock');
          return;
        }
        setStatus('fetching');
        try {
          // Fetch in parallel — minimise time to interactive
          const [me, inbox, integrations] = await Promise.all([
            window.nexleyApi.me().catch(() => null),
            window.nexleyApi.inboxList('all').catch(() => null),
            window.nexleyApi.integrations().catch(() => null),
          ]);
          if (cancelled) return;
          mapToMock({ me, inbox, integrations });
          setStatus('live');
          // Trigger a React re-render of consumers by forcing a microtask
          window.dispatchEvent(new CustomEvent('nexley_data_loaded'));
        } catch (e) {
          if (cancelled) return;
          setError(e.message);
          setStatus('error');
        }
      })();
      return () => { cancelled = true; };
    }, []);

    // Subtle live-mode indicator in top-right corner
    if (status === 'live') {
      return (
        <div style={{
          position: 'absolute', top: 6, right: 14, zIndex: 100,
          fontSize: 9, fontFamily: 'ui-monospace, monospace',
          color: '#22c55e', display: 'flex', alignItems: 'center', gap: 3,
          letterSpacing: '0.05em',
        }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#22c55e' }} />
          LIVE
        </div>
      );
    }
    if (status === 'fetching') {
      return (
        <div style={{
          position: 'absolute', top: 6, right: 14, zIndex: 100,
          fontSize: 9, fontFamily: 'ui-monospace, monospace',
          color: 'rgba(255,255,255,0.5)',
        }}>SYNCING…</div>
      );
    }
    if (status === 'error') {
      return (
        <div style={{
          position: 'absolute', top: 6, right: 14, zIndex: 100,
          fontSize: 9, fontFamily: 'ui-monospace, monospace',
          color: '#ef4444', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis',
        }}>API: {error.slice(0, 40)}</div>
      );
    }
    return null;
  }

  function mapToMock({ me, inbox, integrations }) {
    if (!window.NX_MOCK) return;
    const M = window.NX_MOCK;

    // Business + greeting
    if (me?.client) {
      M.business = M.business || {};
      M.business.name = me.client.name || me.client.business_name || M.business.name;
      M.business.firstName = (me.client.contact_name || M.business.owner || M.business.firstName || 'there').split(' ')[0];
      if (me.client.vps_status === 'live' || me.client.vps_ready) {
        M.business.vps = M.business.vps || {};
        M.business.vps.status = 'live';
      }
    }
    if (me?.ai_employee?.name) {
      M.aiEmployee = M.aiEmployee || {};
      M.aiEmployee.name = me.ai_employee.name;
    }

    // Inbox — map customer conversations to the prototype's shape
    if (inbox?.items) {
      M.inbox = inbox.items.map((c) => ({
        id: c.id,
        name: c.customer_name || 'Customer',
        phone: c.customer_phone || '',
        channel: c.channel || 'whatsapp',
        last: c.last_message_preview || '',
        time: relativeTime(c.last_message_at),
        unread: c.unread_count || 0,
        status: c.status || 'open',
        ai_paused: !!c.ai_paused,
      }));
    }

    // Integrations — overlay live status onto the prototype's known list.
    // The prototype's mock has a richer per-provider record (icon, copy, etc)
    // that we want to keep. Just merge connected_at + status from live data.
    if (integrations?.items && Array.isArray(M.integrations)) {
      const liveByProvider = {};
      for (const i of integrations.items) {
        liveByProvider[i.provider] = i;
      }
      M.integrations = M.integrations.map((p) => {
        const live = liveByProvider[p.id] || liveByProvider[p.id?.toLowerCase()];
        if (!live) return p;
        return {
          ...p,
          status: live.status === 'connected' ? 'connected'
                : live.status === 'expired' ? 'needs_reauth'
                : live.status === 'failed' ? 'failed'
                : p.status,
          connectedAt: live.connected_at,
          lastSyncAt: live.last_sync_at,
        };
      });
    }
  }

  function relativeTime(iso) {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h`;
    const day = Math.floor(hr / 24);
    return `${day}d`;
  }

  Object.assign(window, { LiveBridge });
})();
