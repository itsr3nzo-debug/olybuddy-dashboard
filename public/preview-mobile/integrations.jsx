// ───────── INTEGRATIONS SCREEN + CONNECT SHEET + DETAIL ─────────
// Settings → Integrations. Curated list, six states, OAuth-style modal flow.
//
// v2 fixes from devil's-advocate review:
//   - Real mono SVG logos (silhouettes), no more letter monograms.
//   - Per-integration permissions driven from data, not hardcoded.
//   - Post-connect "try it" suggestion card after a successful connection.
//   - Cancel affordance on the row-level "Connecting…" state.
//   - Empty-state for users on a plan without integrations.
//   - Toast suggestion includes a concrete prompt the user can hand to Nexley.

const NXI_useState = React.useState;
const NXI_useEffect = React.useEffect;
const NXI_useRef = React.useRef;
const NXI_useMemo = React.useMemo;

// ---- shared bits ----

const STATUS_DOT = {
  connected:    'var(--success)',
  needs_reauth: 'var(--warning, #d97706)',
  failed:       'var(--destructive, #dc2626)',
  syncing:      'var(--primary)',
  connecting:   'var(--primary)',
  disconnected: 'transparent',
};

// ProviderMark — renders the integration's mono SVG silhouette in --fg,
// inside a neutral rounded square. No brand colour fills.
function ProviderMark({ p, size = 36, padding }) {
  const pad = padding ?? Math.round(size * 0.18);
  const inner = size - pad * 2;
  return (
    <div style={{
      width: size, height: size, borderRadius: 9,
      background: 'var(--muted)',
      border: '0.5px solid var(--border)',
      display: 'grid', placeItems: 'center',
      flexShrink: 0,
      color: 'var(--fg)',
    }}>
      <svg
        width={inner} height={inner} viewBox="0 0 24 24"
        fill={p.svgKind === 'fill' ? 'currentColor' : 'none'}
        stroke={p.svgKind === 'stroke' ? 'currentColor' : 'none'}
        strokeWidth={p.svgKind === 'stroke' ? 1.6 : 0}
        strokeLinecap="round" strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={p.svg} />
      </svg>
    </div>
  );
}

function StatusDot({ status }) {
  const c = STATUS_DOT[status];
  if (status === 'disconnected') return null;
  const pulse = status === 'syncing' || status === 'connecting';
  return (
    <span style={{
      width: 6, height: 6, borderRadius: 999,
      background: c,
      boxShadow: status === 'connected' ? `0 0 0 3px color-mix(in oklch, ${c} 22%, transparent)` : 'none',
      animation: pulse ? 'nx-dot-pulse 1.4s ease-in-out infinite' : 'none',
      flexShrink: 0,
    }} />
  );
}

function Spinner({ size = 12 }) {
  return (
    <span style={{
      display: 'inline-block', width: size, height: size, borderRadius: 999,
      border: '1.5px solid color-mix(in oklch, var(--primary) 25%, transparent)',
      borderTopColor: 'var(--primary)',
      animation: 'nx-spin 0.8s linear infinite',
    }} />
  );
}

// ---- list row ----

function IntegrationRow({ i, onTap, onConnect, onReconnect, onRetry, onCancelConnecting }) {
  const isConnected = i.status === 'connected';
  const muted = 'var(--muted-fg)';

  let right = null;
  if (i.status === 'connected') {
    right = (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <StatusDot status="connected" />
        <span style={{ fontSize: 11, color: muted, fontFamily: '"Geist Mono", ui-monospace, monospace', letterSpacing: '-0.01em' }}>{i.lastSync}</span>
        <I.ChevronRight size={14} color={muted} />
      </div>
    );
  } else if (i.status === 'syncing') {
    right = (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <StatusDot status="syncing" />
        <span style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 500 }}>Syncing…</span>
        <I.ChevronRight size={14} color={muted} />
      </div>
    );
  } else if (i.status === 'needs_reauth') {
    right = (
      <button onClick={(e) => { e.stopPropagation(); onReconnect(i); }} className="pressable" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500, color: 'var(--warning, #d97706)', background: 'color-mix(in oklch, var(--warning, #d97706) 12%, transparent)', border: '0.5px solid color-mix(in oklch, var(--warning, #d97706) 35%, transparent)', padding: '5px 10px', borderRadius: 7 }}>
        <StatusDot status="needs_reauth" />
        Reconnect
      </button>
    );
  } else if (i.status === 'failed') {
    right = (
      <button onClick={(e) => { e.stopPropagation(); onRetry(i); }} className="pressable" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500, color: 'var(--destructive, #dc2626)', background: 'color-mix(in oklch, var(--destructive, #dc2626) 12%, transparent)', border: '0.5px solid color-mix(in oklch, var(--destructive, #dc2626) 35%, transparent)', padding: '5px 10px', borderRadius: 7 }}>
        <StatusDot status="failed" />
        Retry
      </button>
    );
  } else if (i.status === 'connecting') {
    // Now has a Cancel affordance — fixes the dead-row-on-flaky-connection issue.
    right = (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--primary)', fontWeight: 500 }}>
          <Spinner size={11} />
          Connecting…
        </span>
        <button onClick={(e) => { e.stopPropagation(); onCancelConnecting(i); }} className="pressable" aria-label="Cancel connecting" style={{
          background: 'transparent', border: 'none',
          padding: 4, marginLeft: 1,
          color: muted, display: 'flex', alignItems: 'center',
          borderRadius: 999,
        }}>
          <I.X size={12} />
        </button>
      </div>
    );
  } else {
    // disconnected
    right = (
      <button onClick={(e) => { e.stopPropagation(); onConnect(i); }} className="pressable" style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg)', background: 'transparent', border: '0.5px solid var(--border)', padding: '5px 11px', borderRadius: 7, display: 'flex', alignItems: 'center', gap: 5 }}>
        Connect <I.ArrowRight size={11} />
      </button>
    );
  }

  return (
    <button onClick={() => onTap(i)} className="pressable" style={{
      width: '100%', textAlign: 'left', background: 'transparent', border: 'none',
      padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 12,
      borderBottom: '0.5px solid var(--border)',
      minHeight: 64,
    }}>
      <ProviderMark p={i} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ fontSize: 14.5, fontWeight: 500, color: 'var(--fg)', letterSpacing: '-0.01em' }}>{i.name}</div>
        {isConnected && i.account && (
          <div style={{
            fontSize: 11.5, color: muted, lineHeight: 1.4,
            // Don't ellipsis to a single line — long emails just need to wrap
            // gracefully under the integration name. The row already minWidth:0s.
            wordBreak: 'break-word',
          }}>{i.account}</div>
        )}
        {i.status === 'needs_reauth' && i.reason && (
          <div style={{ fontSize: 11.5, color: 'var(--warning, #d97706)' }}>{i.reason}</div>
        )}
        {i.status === 'failed' && i.reason && (
          <div style={{ fontSize: 11.5, color: 'var(--destructive, #dc2626)' }}>{i.reason}</div>
        )}
        {!isConnected && i.status !== 'needs_reauth' && i.status !== 'failed' && i.status !== 'connecting' && (
          <div style={{ fontSize: 11.5, color: muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.desc}</div>
        )}
      </div>
      {right}
    </button>
  );
}

// ---- post-connect suggestion card ----
// Shown inline on the list after a successful connect, suggesting a concrete
// prompt the user can immediately hand to Nexley. Dismissable.
function SuggestionCard({ provider, aiName, onTry, onDismiss }) {
  if (!provider?.suggestion) return null;
  return (
    <div style={{
      margin: '12px 16px 6px',
      background: 'color-mix(in oklch, var(--primary) 7%, var(--card))',
      border: '0.5px solid color-mix(in oklch, var(--primary) 30%, var(--border))',
      borderRadius: 14,
      padding: '13px 14px',
      display: 'flex', flexDirection: 'column', gap: 10,
      animation: 'nx-rise 320ms cubic-bezier(0.2, 0.8, 0.2, 1)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <I.Sparkles size={13} color="var(--primary)" />
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--primary)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Try it now
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={onDismiss} className="pressable" aria-label="Dismiss" style={{ background: 'transparent', border: 'none', padding: 2, color: 'var(--muted-fg)', display: 'flex' }}>
          <I.X size={13} />
        </button>
      </div>
      <div style={{ fontSize: 13.5, color: 'var(--fg)', lineHeight: 1.45, letterSpacing: '-0.005em', textWrap: 'pretty' }}>
        Ask {aiName}: <span style={{ fontStyle: 'italic' }}>{provider.suggestion}</span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onTry} className="pressable" style={{
          padding: '7px 12px', borderRadius: 8,
          background: 'var(--primary)', color: 'var(--primary-fg)',
          border: 'none', fontSize: 12.5, fontWeight: 500,
          display: 'inline-flex', alignItems: 'center', gap: 5,
        }}>
          Open chat <I.ArrowRight size={11} />
        </button>
        <button onClick={onDismiss} className="pressable" style={{
          padding: '7px 11px', borderRadius: 8,
          background: 'transparent', color: 'var(--muted-fg)',
          border: 'none', fontSize: 12.5, fontWeight: 500,
        }}>
          Maybe later
        </button>
      </div>
    </div>
  );
}

// ---- empty state (plan doesn't include integrations) ----
function IntegrationsEmptyState({ data }) {
  return (
    <div style={{ padding: '32px 22px 20px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 14 }}>
      <div style={{
        width: 44, height: 44, borderRadius: 12,
        background: 'var(--muted)',
        border: '0.5px solid var(--border)',
        display: 'grid', placeItems: 'center',
        color: 'var(--muted-fg)',
      }}>
        <I.Plug size={20} />
      </div>
      <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.025em', color: 'var(--fg)', lineHeight: 1.3, textWrap: 'pretty' }}>
        {data.title}
      </div>
      <div style={{ fontSize: 13.5, color: 'var(--muted-fg)', lineHeight: 1.5, textWrap: 'pretty' }}>
        {data.body}
      </div>
      <button className="pressable" style={{
        marginTop: 4, padding: '11px 16px', borderRadius: 11,
        background: 'var(--primary)', color: 'var(--primary-fg)',
        border: 'none', fontSize: 13.5, fontWeight: 600,
        display: 'inline-flex', alignItems: 'center', gap: 6,
      }}>
        {data.cta} <I.ArrowRight size={12} />
      </button>
    </div>
  );
}

// ---- screen ----

function IntegrationsScreen({ onBack, onOpenChat }) {
  const M = window.NX_MOCK;
  const flags = M.demoFlags || {};
  // Fresh onboarding wipes connected-state so the user sees the same Day-0 list
  // they'd land on after signup. Without this, the "Connected · Gmail" rows
  // contradict the empty home/inbox screens.
  const initialItems = NXI_useMemo(() => {
    if (flags.freshOnboarding) {
      return M.integrations.map(i => ({
        ...i,
        status: 'disconnected',
        account: undefined,
        lastSync: undefined,
        reason: undefined,
      }));
    }
    return M.integrations;
  }, [flags.freshOnboarding]);

  const [items, setItems] = NXI_useState(initialItems);
  // If the flag flips while the screen is mounted, reset the list to match.
  NXI_useEffect(() => { setItems(initialItems); }, [initialItems]);

  const [sheet, setSheet]   = NXI_useState(null); // provider being connected
  const [detail, setDetail] = NXI_useState(null); // provider being viewed
  const [toast, setToast]   = NXI_useState(null); // string
  // If the demo flag asks for a just-connected suggestion, pre-populate it with
  // Slack (which has the canonical "ping me when…" prompt). Otherwise null.
  const slackProto = NXI_useMemo(
    () => M.integrations.find(x => x.id === 'slack'),
    []
  );
  const [suggestion, setSuggestion] = NXI_useState(
    flags.justConnectedSlack && slackProto ? { ...slackProto, status: 'connected' } : null
  );
  NXI_useEffect(() => {
    if (flags.justConnectedSlack && slackProto) {
      setSuggestion({ ...slackProto, status: 'connected' });
    } else if (!flags.justConnectedSlack) {
      setSuggestion(s => (s && s.id === 'slack' ? null : s));
    }
  }, [flags.justConnectedSlack]);

  const aiName = M.business?.aiName || 'Nexley';
  const empty = M.integrationsEmptyState?.enabled;

  // group items
  const grouped = NXI_useMemo(() => {
    const map = new Map();
    items.forEach(i => {
      if (!map.has(i.group)) map.set(i.group, []);
      map.get(i.group).push(i);
    });
    return [...map.entries()];
  }, [items]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(t => (t === msg ? null : t)), 3200);
  };

  const setStatus = (id, patch) => {
    setItems(arr => arr.map(x => x.id === id ? { ...x, ...patch } : x));
  };

  const beginConnect = (p) => setSheet(p);

  const completeConnect = async (p) => {
    setSheet(null);
    setStatus(p.id, { status: 'connecting' });

    const isLive = !!(window.nexleyApi && window.nexleyApi.isLive());
    if (isLive) {
      // Real OAuth: hit /api/mobile/integrations/[provider]/connect, get URL,
      // open it in a new tab. The callback will land in our database; the
      // user closes the tab and we poll once for status.
      try {
        const resp = await window.nexleyApi.integrationConnect(p.id);
        if (resp.url) {
          // Open the OAuth provider in a new tab/window
          window.open(resp.url, '_blank', 'noopener,noreferrer');
          showToast(`${p.name} — finish connecting in the new tab. We'll refresh when you return.`);
          // Poll integrations list for up to 90s waiting for the row to flip
          let attempts = 0;
          const poll = setInterval(async () => {
            attempts++;
            try {
              const fresh = await window.nexleyApi.integrations();
              const found = (fresh.items || []).find(i => i.provider === p.id);
              if (found && found.status === 'connected') {
                clearInterval(poll);
                setStatus(p.id, {
                  status: 'connected',
                  account: found.account_label || p.account,
                  lastSync: 'just now',
                  connectedAt: found.connected_at,
                  reason: undefined,
                });
                showToast(`${p.name} connected · ${aiName} can now ${(p.capabilities[0] || 'help').toLowerCase()}.`);
                if (p.suggestion) setSuggestion({ ...p, status: 'connected' });
              } else if (attempts > 30) {
                clearInterval(poll);
                setStatus(p.id, { status: 'disconnected', reason: 'OAuth not completed in time.' });
              }
            } catch {
              // Continue polling
            }
          }, 3000);
        } else {
          throw new Error('No OAuth URL returned');
        }
      } catch (err) {
        console.error('Connect failed:', err);
        setStatus(p.id, { status: 'disconnected', reason: err.message || 'Connect failed' });
        showToast(`${p.name} connection failed: ${err.message || 'unknown'}`);
      }
      return;
    }

    // Mock mode — fake success after 1.1s as before
    setTimeout(() => {
      const live = items.find(x => x.id === p.id) || p;
      if (live.status === 'disconnected') return;
      setStatus(p.id, {
        status: 'connected',
        account: p.account || 'tom@varleyelectrical.co.uk',
        lastSync: 'just now',
        reason: undefined,
      });
      const cap = p.capabilities[0] || 'help';
      showToast(`${p.name} connected · ${aiName} can now ${cap.toLowerCase()}.`);
      if (p.suggestion) setSuggestion({ ...p, status: 'connected' });
    }, 1100);
  };

  const cancelConnecting = (p) => {
    setStatus(p.id, { status: 'disconnected', account: undefined, lastSync: undefined });
    showToast(`${p.name} connection cancelled.`);
  };

  const reconnect = (p) => beginConnect(p);
  const retry = (p) => beginConnect(p);

  const disconnect = async (p) => {
    const isLive = !!(window.nexleyApi && window.nexleyApi.isLive());
    if (isLive) {
      try {
        await window.nexleyApi.integrationDisconnect(p.id);
      } catch (err) {
        console.error('Disconnect failed:', err);
        showToast(`${p.name} disconnect failed: ${err.message || 'unknown'}`);
        return;
      }
    }
    setStatus(p.id, { status: 'disconnected', account: undefined, lastSync: undefined, reason: undefined });
    setDetail(null);
    showToast(`${p.name} disconnected.`);
  };

  // Provider detail page
  if (detail) {
    const live = items.find(x => x.id === detail.id) || detail;
    return <IntegrationDetail
      p={live}
      onBack={() => setDetail(null)}
      onConnect={() => beginConnect(live)}
      onReconnect={() => reconnect(live)}
      onRetry={() => retry(live)}
      onDisconnect={() => disconnect(live)}
    />;
  }

  return (
    <div className="nx-screen" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px 14px', flexShrink: 0 }}>
        {onBack && (
          <button onClick={onBack} className="pressable" style={{ background: 'none', border: 'none', padding: 6, marginLeft: -6, color: 'var(--fg)', display: 'flex' }} aria-label="Back">
            <I.ChevronLeft size={20} />
          </button>
        )}
        <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.025em', color: 'var(--fg)' }}>Apps</div>
        <div style={{ flex: 1 }} />
      </div>

      {/* Scroll body */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        {empty ? (
          <IntegrationsEmptyState data={M.integrationsEmptyState} />
        ) : (
          <>
            {/* Intro copy */}
            <div style={{ padding: '0 18px 18px' }}>
              <div style={{ fontSize: 15, color: 'var(--fg)', lineHeight: 1.45, fontWeight: 500, letterSpacing: '-0.01em' }}>
                Connect the tools you already use.
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted-fg)', lineHeight: 1.5, marginTop: 5, textWrap: 'pretty' }}>
                Your AI Employee can draft Gmail replies, book calendar slots, and create estimates in your accounting tool — but only after you connect them.
              </div>
            </div>

            {/* Inline post-connect suggestion */}
            {suggestion && (
              <SuggestionCard
                provider={suggestion}
                aiName={aiName}
                onTry={() => { setSuggestion(null); onOpenChat?.(); }}
                onDismiss={() => setSuggestion(null)}
              />
            )}

            {/* Grouped list */}
            {grouped.map(([group, list]) => (
              <div key={group} style={{ marginBottom: 4 }}>
                <div style={{ padding: '12px 16px 6px', fontSize: 10.5, fontWeight: 600, color: 'var(--muted-fg)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  {group}
                </div>
                <div style={{ borderTop: '0.5px solid var(--border)' }}>
                  {list.map(i => (
                    <IntegrationRow
                      key={i.id} i={i}
                      onTap={(p) => setDetail(p)}
                      onConnect={beginConnect}
                      onReconnect={reconnect}
                      onRetry={retry}
                      onCancelConnecting={cancelConnecting}
                    />
                  ))}
                </div>
              </div>
            ))}

            {/* Footer */}
            <div style={{ padding: '20px 18px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ fontSize: 12.5, color: 'var(--muted-fg)' }}>Need something else?</div>
              <button className="pressable" style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--fg)', background: 'transparent', border: '0.5px solid var(--border)', padding: '5px 11px', borderRadius: 7 }}>
                Request integration
              </button>
            </div>
          </>
        )}
      </div>

      {/* Connect sheet */}
      {sheet && (
        <ConnectSheet
          p={sheet}
          onClose={() => setSheet(null)}
          onConfirm={() => completeConnect(sheet)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'absolute', left: 12, right: 12, bottom: 14,
          background: 'var(--fg)', color: 'var(--bg)',
          padding: '10px 14px', borderRadius: 12,
          fontSize: 13, fontWeight: 500, letterSpacing: '-0.01em',
          boxShadow: '0 12px 30px rgba(0,0,0,0.18)',
          animation: 'nx-toast 220ms ease-out',
          zIndex: 30,
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}

// ---- connect sheet (modal) ----

function ConnectSheet({ p, onClose, onConfirm }) {
  const [phase, setPhase] = NXI_useState('confirm'); // 'confirm' | 'oauth'

  // OAuth simulation: 1.4s "system auth" view then auto-success.
  // Now styled as a system-modal dim rather than fake browser chrome,
  // because real iOS uses ASWebAuthenticationSession — opaque to the app.
  NXI_useEffect(() => {
    if (phase !== 'oauth') return;
    const t = setTimeout(() => onConfirm(), 1400);
    return () => clearTimeout(t);
  }, [phase, onConfirm]);

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 40, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', animation: 'nx-fade 160ms ease-out' }} />

      {/* Sheet */}
      <div style={{
        position: 'relative',
        background: 'var(--bg)',
        borderTopLeftRadius: 22, borderTopRightRadius: 22,
        padding: '8px 18px 22px',
        animation: 'nx-sheet 240ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        borderTop: '0.5px solid var(--border)',
        maxHeight: '88%',
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* drag handle */}
        <div style={{ width: 36, height: 4, borderRadius: 999, background: 'var(--border)', alignSelf: 'center', marginBottom: 8 }} />

        {phase === 'confirm' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                <ProviderMark p={p} size={42} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--fg)' }}>{p.name}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted-fg)' }}>{p.group}</div>
                </div>
              </div>
              <button onClick={onClose} className="pressable" style={{ background: 'var(--muted)', border: 'none', padding: 7, borderRadius: 999, color: 'var(--muted-fg)', display: 'flex' }} aria-label="Close">
                <I.X size={14} />
              </button>
            </div>

            <div style={{ fontSize: 13.5, color: 'var(--fg)', lineHeight: 1.5, marginBottom: 14, textWrap: 'pretty' }}>{p.desc}</div>

            <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--muted-fg)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
              What your AI Employee can do
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 22 }}>
              {p.capabilities.map((c, idx) => (
                <li key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: 'var(--fg)', lineHeight: 1.45 }}>
                  <span style={{ marginTop: 5, flexShrink: 0, width: 4, height: 4, borderRadius: 999, background: 'var(--primary)' }} />
                  <span style={{ textWrap: 'pretty' }}>{c}</span>
                </li>
              ))}
            </ul>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button onClick={() => setPhase('oauth')} className="pressable" style={{
                width: '100%', padding: '13px 16px', borderRadius: 12,
                background: 'var(--primary)', color: 'var(--primary-fg)',
                border: 'none', fontSize: 14.5, fontWeight: 600, letterSpacing: '-0.01em',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              }}>
                Connect {p.name}
              </button>
              <button onClick={onClose} className="pressable" style={{
                width: '100%', padding: '11px 16px', borderRadius: 12,
                background: 'transparent', color: 'var(--muted-fg)',
                border: 'none', fontSize: 13.5, fontWeight: 500,
              }}>
                Cancel
              </button>
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--muted-fg)', textAlign: 'center', marginTop: 4, lineHeight: 1.5 }}>
              You'll sign in securely with {p.name}. We never see your password.
            </div>
          </>
        )}

        {phase === 'oauth' && (
          // System-style auth: dim card with provider mark, no fake browser chrome.
          // Real iOS shows ASWebAuthenticationSession (opaque modal) — this is a
          // truthful prototype of what the user will actually see.
          <div style={{ padding: '8px 0 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
            <div style={{
              width: '100%', background: 'var(--card)',
              border: '0.5px solid var(--border)', borderRadius: 16,
              padding: '28px 22px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--muted-fg)' }}>
                <I.Lock size={11} />
                <span style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 }}>Secure sign-in</span>
              </div>
              <ProviderMark p={p} size={56} />
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--fg)', letterSpacing: '-0.02em', textAlign: 'center' }}>
                Authorizing {p.name}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--muted-fg)', textAlign: 'center', lineHeight: 1.5, maxWidth: 240, textWrap: 'pretty' }}>
                Sign in to {p.name} in the secure window that just opened.
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <Spinner size={12} />
                <span style={{ fontSize: 12, color: 'var(--muted-fg)' }}>Waiting for {p.name}…</span>
              </div>
            </div>
            <button onClick={onClose} className="pressable" style={{
              padding: '9px 14px', background: 'transparent', color: 'var(--muted-fg)',
              border: '0.5px solid var(--border)', borderRadius: 9, fontSize: 12.5, fontWeight: 500,
            }}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- detail page ----

function IntegrationDetail({ p, onBack, onConnect, onReconnect, onRetry, onDisconnect }) {
  const isConnected = p.status === 'connected' || p.status === 'syncing';

  return (
    <div className="nx-screen" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px 14px', flexShrink: 0 }}>
        <button onClick={onBack} className="pressable" style={{ background: 'none', border: 'none', padding: 6, marginLeft: -6, color: 'var(--fg)', display: 'flex' }} aria-label="Back">
          <I.ChevronLeft size={20} />
        </button>
        <div style={{ fontSize: 13, color: 'var(--muted-fg)', fontWeight: 500 }}>Apps</div>
        <div style={{ flex: 1 }} />
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        {/* Hero */}
        <div style={{ padding: '6px 18px 22px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 14 }}>
          <ProviderMark p={p} size={56} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.025em', color: 'var(--fg)' }}>{p.name}</div>
            <div style={{ fontSize: 12, color: 'var(--muted-fg)', letterSpacing: '0.02em' }}>{p.group}</div>
          </div>
          <div style={{ fontSize: 14, color: 'var(--fg)', lineHeight: 1.5, textWrap: 'pretty' }}>{p.desc}</div>
        </div>

        {/* Status card */}
        <div style={{ padding: '0 16px' }}>
          <div style={{
            background: 'var(--card)',
            border: '0.5px solid var(--border)',
            borderRadius: 14,
            padding: 14,
            display: 'flex', flexDirection: 'column', gap: 11,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted-fg)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Status</div>
              {p.status === 'connected' && <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--success)', fontWeight: 500 }}><StatusDot status="connected" /> Connected</span>}
              {p.status === 'syncing' && <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--primary)', fontWeight: 500 }}><StatusDot status="syncing" /> Syncing</span>}
              {p.status === 'needs_reauth' && <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--warning, #d97706)', fontWeight: 500 }}><StatusDot status="needs_reauth" /> Needs reauth</span>}
              {p.status === 'failed' && <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--destructive, #dc2626)', fontWeight: 500 }}><StatusDot status="failed" /> Failed</span>}
              {p.status === 'disconnected' && <span style={{ fontSize: 12, color: 'var(--muted-fg)', fontWeight: 500 }}>Not connected</span>}
            </div>

            {p.account && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ fontSize: 12.5, color: 'var(--muted-fg)', flexShrink: 0 }}>Account</div>
                <div style={{ fontSize: 12.5, color: 'var(--fg)', fontFamily: '"Geist Mono", ui-monospace, monospace', letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{p.account}</div>
              </div>
            )}
            {p.lastSync && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ fontSize: 12.5, color: 'var(--muted-fg)', flexShrink: 0, whiteSpace: 'nowrap' }}>Last sync</div>
                <div style={{ fontSize: 12.5, color: 'var(--fg)', fontFamily: '"Geist Mono", ui-monospace, monospace', whiteSpace: 'nowrap' }}>{p.lastSync}</div>
              </div>
            )}
            {p.reason && (
              <div style={{
                fontSize: 12.5, color: p.status === 'failed' ? 'var(--destructive, #dc2626)' : 'var(--warning, #d97706)',
                background: `color-mix(in oklch, ${p.status === 'failed' ? 'var(--destructive, #dc2626)' : 'var(--warning, #d97706)'} 10%, transparent)`,
                padding: '8px 11px', borderRadius: 9, lineHeight: 1.45,
                display: 'flex', alignItems: 'flex-start', gap: 8,
              }}>
                <I.AlertTriangle size={13} style={{ marginTop: 1, flexShrink: 0 }} />
                <span>{p.reason}</span>
              </div>
            )}
          </div>
        </div>

        {/* Capabilities */}
        <div style={{ padding: '24px 16px 8px', fontSize: 10.5, fontWeight: 600, color: 'var(--muted-fg)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          What your AI Employee can do
        </div>
        <div style={{ padding: '0 16px' }}>
          <div style={{
            background: 'var(--card)',
            border: '0.5px solid var(--border)',
            borderRadius: 14,
            overflow: 'hidden',
          }}>
            {p.capabilities.map((c, idx) => (
              <div key={idx} style={{
                padding: '11px 13px',
                borderBottom: idx < p.capabilities.length - 1 ? '0.5px solid var(--border)' : 'none',
                display: 'flex', alignItems: 'flex-start', gap: 9,
                fontSize: 13, color: 'var(--fg)', lineHeight: 1.4, letterSpacing: '-0.01em',
              }}>
                <I.Check size={12} color={isConnected ? 'var(--success)' : 'var(--muted-fg)'} style={{ marginTop: 3, flexShrink: 0 }} />
                <span style={{ textWrap: 'pretty' }}>{c}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Permissions toggle (connected only) — driven by per-integration data */}
        {isConnected && p.permissions && p.permissions.length > 0 && (
          <>
            <div style={{ padding: '24px 16px 8px', fontSize: 10.5, fontWeight: 600, color: 'var(--muted-fg)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Permissions
            </div>
            <div style={{ padding: '0 16px' }}>
              {p.permissions.map(perm => (
                <PermissionToggle
                  key={perm.id}
                  permId={perm.id}
                  label={perm.label}
                  defaultOn={perm.defaultOn}
                />
              ))}
            </div>
          </>
        )}

        {/* Disconnect */}
        <div style={{ padding: '28px 16px 28px' }}>
          {p.status === 'disconnected' && (
            <button onClick={onConnect} className="pressable" style={{
              width: '100%', padding: '13px 16px', borderRadius: 12,
              background: 'var(--primary)', color: 'var(--primary-fg)',
              border: 'none', fontSize: 14.5, fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            }}>
              Connect {p.name}
            </button>
          )}
          {p.status === 'needs_reauth' && (
            <button onClick={onReconnect} className="pressable" style={{
              width: '100%', padding: '13px 16px', borderRadius: 12,
              background: 'var(--warning, #d97706)', color: 'white',
              border: 'none', fontSize: 14.5, fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            }}>
              <I.Refresh size={14} /> Reconnect {p.name}
            </button>
          )}
          {p.status === 'failed' && (
            <button onClick={onRetry} className="pressable" style={{
              width: '100%', padding: '13px 16px', borderRadius: 12,
              background: 'transparent', color: 'var(--destructive, #dc2626)',
              border: '0.5px solid color-mix(in oklch, var(--destructive, #dc2626) 40%, transparent)',
              fontSize: 14.5, fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            }}>
              <I.Refresh size={14} /> Try again
            </button>
          )}
          {(p.status === 'connected' || p.status === 'syncing') && (
            <button onClick={onDisconnect} className="pressable" style={{
              width: '100%', padding: '11px 16px', borderRadius: 11,
              background: 'transparent', color: 'var(--destructive, #dc2626)',
              border: '0.5px solid color-mix(in oklch, var(--destructive, #dc2626) 35%, transparent)',
              fontSize: 13, fontWeight: 500,
            }}>
              Disconnect
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function PermissionToggle({ label, defaultOn, permId }) {
  // Demo flag: when "Permissive auto-reply" is on, auto_reply toggles start on.
  const flags = (window.NX_MOCK && window.NX_MOCK.demoFlags) || {};
  const initial = (permId === 'auto_reply' && flags.permissivePermissions) ? true : !!defaultOn;
  const [on, setOn] = NXI_useState(initial);
  return (
    <button onClick={() => setOn(!on)} className="pressable" style={{
      width: '100%', textAlign: 'left',
      padding: '13px 14px',
      background: 'var(--card)', border: '0.5px solid var(--border)',
      borderRadius: 11, marginBottom: 8,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
    }}>
      <span style={{ fontSize: 13.5, color: 'var(--fg)', fontWeight: 500, lineHeight: 1.35, textWrap: 'pretty' }}>{label}</span>
      <span style={{
        width: 36, height: 22, borderRadius: 999,
        background: on ? 'var(--primary)' : 'color-mix(in oklch, var(--fg) 18%, transparent)',
        position: 'relative',
        transition: 'background 180ms ease',
        flexShrink: 0,
      }}>
        <span style={{
          position: 'absolute', top: 2, left: on ? 16 : 2,
          width: 18, height: 18, borderRadius: 999, background: 'white',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          transition: 'left 180ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        }} />
      </span>
    </button>
  );
}

Object.assign(window, { IntegrationsScreen, IntegrationDetail, ConnectSheet });
