// Nexley Mobile — primitives + screens (Home, Chat, Conversation detail)
// Composed inside an iOS frame in index.html

const NX_useState = React.useState;
const NX_useEffect = React.useEffect;
const NX_useRef = React.useRef;
const NX_useMemo = React.useMemo;
const I = window.Icons;

// ───────── Primitives ─────────
function Avatar({ initials, size = 32, tone = 'card', gradient = false }) {
  if (gradient) {
    return (
      <div className="nx-avatar-gradient" style={{
        width: size, height: size, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.38, fontWeight: 600, letterSpacing: '-0.02em', flexShrink: 0,
      }}>{initials}</div>
    );
  }
  // Hash-based hue tint for variety
  const hash = (initials || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const hue = (hash * 47) % 360;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `oklch(0.92 0.04 ${hue} / 0.4)`,
      color: 'var(--fg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38, fontWeight: 600, letterSpacing: '-0.02em', flexShrink: 0,
      border: '0.5px solid var(--border)',
      backgroundImage: `linear-gradient(135deg, oklch(0.96 0.04 ${hue}) 0%, oklch(0.85 0.07 ${hue}) 100%)`,
    }}>{initials}</div>
  );
}

function Eyebrow({ children, style }) {
  return <div style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted-fg)', whiteSpace: 'nowrap', ...style }}>{children}</div>;
}

function Sparkline({ data, height = 56, opacity = 0.45 }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 100;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, height - ((v - min) / range) * (height - 8) - 4]);
  // smooth via cubic
  const smooth = pts.reduce((d, p, i, arr) => {
    if (i === 0) return `M ${p[0]} ${p[1]}`;
    const prev = arr[i - 1];
    const cx1 = prev[0] + (p[0] - prev[0]) * 0.5;
    const cy1 = prev[1];
    const cx2 = prev[0] + (p[0] - prev[0]) * 0.5;
    const cy2 = p[1];
    return `${d} C ${cx1} ${cy1} ${cx2} ${cy2} ${p[0]} ${p[1]}`;
  }, '');
  const area = `${smooth} L ${w} ${height} L 0 ${height} Z`;
  const id = 'spk-' + Math.random().toString(36).slice(2, 7);
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity={opacity} />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={smooth} fill="none" stroke="var(--primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="2" fill="var(--primary)" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function AnimatedNumber({ value, prefix = '', duration = 1100 }) {
  const [n, setN] = NX_useState(value);
  NX_useEffect(() => {
    const start = performance.now();
    let raf;
    const tick = (t) => {
      const p = Math.min((t - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(Math.round(value * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span className="mono" style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.04em' }}>{prefix}{n.toLocaleString('en-GB')}</span>;
}

// ───────── HOME ─────────
function HomeScreen({ density, aiName, onOpenChat, onOpenConversation, onOpenInbox }) {
  const M = window.NX_MOCK;
  const fresh = !!(M.demoFlags && M.demoFlags.freshOnboarding);
  const compact = density === 'compact';
  const padX = compact ? 16 : 18;
  const gap = compact ? 14 : 18;
  const [showProvenance, setShowProvenance] = NX_useState(false);

  return (
    <div className="nx-screen">
      {/* Header */}
      <div style={{ padding: `8px ${padX}px 4px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 13, color: 'var(--muted-fg)' }}>Wednesday, 12 Mar</div>
          <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.025em', marginTop: 1 }}>Morning, {M.business.firstName}.</div>
        </div>
        <Avatar initials="TV" size={38} gradient />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: `${gap}px ${padX}px 24px`, display: 'flex', flexDirection: 'column', gap }}>
        {/* AI status row — owner friendly */}
        <div className="rise" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--card)', border: '0.5px solid var(--border)', borderRadius: 999 }}>
          <div className="status-dot" />
          <div style={{ fontSize: 12.5, color: 'var(--muted-fg)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <span style={{ color: 'var(--fg)', fontWeight: 500 }}>{aiName}</span> · active 2m ago
          </div>
          <button className="pressable" style={{ background: 'transparent', border: 'none', padding: '2px 4px', color: 'var(--muted-fg)', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <I.Pause size={11} /> Pause
          </button>
        </div>

        {/* Hero ROI card — or Day-0 setup card if user just onboarded */}
        {fresh ? (
          <div className="rise nx-hero" style={{ padding: '20px 18px', animationDelay: '40ms' }}>
            <Eyebrow>Welcome to {aiName}</Eyebrow>
            <div style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.025em', marginTop: 8, lineHeight: 1.25, textWrap: 'pretty', color: 'var(--fg)' }}>
              Three steps and {aiName} is answering customers for you.
            </div>
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 9 }}>
              {[
                { n: 1, label: 'Connect WhatsApp', sub: 'so customers can reach you', done: false },
                { n: 2, label: 'Add your services & pricing', sub: '5 min · we\'ll suggest from your trade', done: false },
                { n: 3, label: 'Try a test conversation', sub: 'see how it sounds in your voice', done: false },
              ].map((s) => (
                <div key={s.n} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 0' }}>
                  <div style={{ width: 24, height: 24, borderRadius: '50%', border: '1px solid var(--border-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 12, fontWeight: 600, color: 'var(--muted-fg)' }}>{s.n}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, color: 'var(--fg)', fontWeight: 500 }}>{s.label}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted-fg)', marginTop: 1 }}>{s.sub}</div>
                  </div>
                  <I.ChevronRight size={14} color="var(--muted-fg)" />
                </div>
              ))}
            </div>
          </div>
        ) : (
        <div className="rise nx-hero" style={{ padding: '18px 18px 0', animationDelay: '40ms' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Eyebrow>Hours saved this week</Eyebrow>
              <button onClick={() => setShowProvenance(s => !s)} className="pressable" style={{ background: 'transparent', border: 'none', padding: 4, color: 'var(--muted-fg)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                <I.Info size={12} /> {showProvenance ? 'hide' : 'breakdown'}
              </button>
            </div>
            {(() => {
              const totalH = M.roi.hoursSaved;
              const wholeH = Math.floor(totalH);
              const wholeM = Math.round((totalH - wholeH) * 60);
              return (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', color: 'var(--fg)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.05em', lineHeight: 0.95, fontWeight: 600 }}>
                    <span style={{ fontSize: 52 }}><AnimatedNumber value={wholeH} /></span>
                    <span style={{ fontSize: 22, marginLeft: 3, marginRight: 8, color: 'var(--muted-fg)', fontWeight: 500, letterSpacing: '-0.02em' }}>h</span>
                    <span style={{ fontSize: 38, fontWeight: 500 }}><AnimatedNumber value={wholeM} /></span>
                    <span style={{ fontSize: 18, marginLeft: 2, color: 'var(--muted-fg)', fontWeight: 500, letterSpacing: '-0.02em' }}>m</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: 2, padding: '2px 6px', background: 'var(--success-soft)', borderRadius: 4, fontWeight: 500 }}>
                    <I.ArrowUp size={10} /> {M.roi.deltaPctVsLastWeek}%
                  </div>
                </div>
              );
            })()}
            <div style={{ fontSize: 12, color: 'var(--muted-fg)', marginTop: 6, lineHeight: 1.5 }}>
              About {Math.round(M.roi.hoursSaved / 5 * 10) / 10}h per working day · vs. last week
            </div>
            {showProvenance && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '0.5px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {M.roi.breakdown.map((b, i) => {
                  const h = Math.floor(b.totalMin / 60);
                  const m = b.totalMin % 60;
                  const label = h > 0 ? `${h}h ${m}m` : `${m}m`;
                  return (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: 'var(--muted-fg)' }}>{b.label}</span>
                      <span className="mono" style={{ color: 'var(--fg)' }}>{b.count} × {b.perItemMin}m = {label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          <div style={{ marginTop: 14, marginLeft: -18, marginRight: -18, marginBottom: -1 }}>
            <Sparkline data={M.roi.sparkline} height={48} opacity={0.35} />
          </div>
        </div>
        )}

        {/* This week's tally + Awaiting reply */}
        {!fresh && (
        <div className="rise" style={{ animationDelay: '80ms' }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--muted-fg)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
            This week
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {[
              { icon: <I.Chat size={13} />, label: 'Messages', value: M.digest.messages },
              { icon: <I.Phone size={13} />, label: 'Calls', value: M.digest.calls },
              { icon: <I.Calendar size={13} />, label: 'Bookings', value: M.digest.bookings },
            ].map((k, i) => (
              <div key={i} style={{ background: 'var(--card)', border: '0.5px solid var(--border)', borderRadius: 10, padding: '11px 12px' }}>
                <div style={{ color: 'var(--muted-fg)', display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>{k.icon}<span>{k.label}</span></div>
                <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.035em', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{k.value}</div>
              </div>
            ))}
          </div>
          {/* awaiting reply banner */}
          <div onClick={onOpenInbox} className="pressable" style={{ marginTop: 10, padding: '11px 14px', background: 'var(--warning-soft)', border: '0.5px solid color-mix(in oklch, var(--warning) 35%, transparent)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0, flex: 1 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--warning)', flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{M.digest.awaitingReply}</span> awaiting your reply
              </span>
            </div>
            <I.ChevronRight size={15} color="var(--muted-fg)" />
          </div>
        </div>
        )}

        {/* Recent activity */}
        {!fresh && (
        <div className="rise" style={{ animationDelay: '120ms' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10, gap: 8 }}>
            <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.02em' }}>Recent activity</div>
            <button style={{ background: 'none', border: 'none', color: 'var(--muted-fg)', fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0, padding: 0 }}>See all <I.ChevronRight size={11} style={{ verticalAlign: '-1px' }} /></button>
          </div>
          <div style={{ background: 'var(--card)', border: '0.5px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            {M.activity.map((a, i) => {
              const iconMap = { message: <I.Chat size={13} />, calendar: <I.Calendar size={13} />, file: <I.File size={13} />, phone: <I.Phone size={13} /> };
              return (
                <div key={a.id} className="pressable" onClick={() => a.type === 'reply' && onOpenConversation('c1')} style={{ padding: '12px 13px', display: 'flex', alignItems: 'flex-start', gap: 11, borderTop: i === 0 ? 'none' : '0.5px solid var(--border)' }}>
                  <div style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted-fg)', flexShrink: 0, marginTop: 1 }}>{iconMap[a.icon]}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="clamp-2" style={{ fontSize: 13, lineHeight: 1.4, color: 'var(--fg)' }}>{a.text}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted-fg)', marginTop: 3 }}>{a.time}</div>
                  </div>
                  <I.ChevronRight size={14} color="var(--muted-fg)" style={{ flexShrink: 0, marginTop: 4 }} />
                </div>
              );
            })}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

// ───────── CHAT (with Nexley) ─────────
function OwnerChatScreen({ aiName, onBack }) {
  const M = window.NX_MOCK;
  const fresh = !!(M.demoFlags && M.demoFlags.freshOnboarding);
  // Day-0: empty thread, suggested starter prompts. Otherwise: this-week ROI recap.
  const [messages, setMessages] = NX_useState(fresh ? [] : M.ownerChat);
  const [input, setInput] = NX_useState('');
  const [streaming, setStreaming] = NX_useState(false);
  const [streamText, setStreamText] = NX_useState('');
  const scrollRef = NX_useRef(null);

  NX_useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streamText]);

  // Persisted across sends so live-mode SSE can resume the same conversation
  const conversationIdRef = NX_useRef(null);

  const send = async () => {
    if (!input.trim() || streaming) return;
    const text = input.trim();
    const userMsg = { id: 'u' + Date.now(), role: 'owner', text, time: 'now' };
    setMessages(m => [...m, userMsg]);
    setInput('');
    setStreaming(true);
    setStreamText('');

    const isLive = !!(window.nexleyApi && window.nexleyApi.isLive());

    if (!isLive) {
      // Mock mode — simulate streaming the same canned reply as before
      const reply = "Sure — let me pull that up.";
      let i = 0;
      const interval = setInterval(() => {
        i++;
        setStreamText(reply.slice(0, i));
        if (i >= reply.length) {
          clearInterval(interval);
          setTimeout(() => {
            setMessages(m => [...m, { id: 'a' + Date.now(), role: 'ai', text: reply, time: 'now' }]);
            setStreaming(false);
            setStreamText('');
          }, 200);
        }
      }, 28);
      return;
    }

    // Live mode — POST to /api/mobile/chat/send → open EventSource on /api/chat/stream
    try {
      const sendResp = await window.nexleyApi.chatSend({
        conversation_id: conversationIdRef.current ?? undefined,
        content: text,
      }, 'chat-' + Date.now());
      conversationIdRef.current = sendResp.conversation_id;

      // DA fix E16: chatStreamUrl now awaits a short-lived single-use ticket
      // so the JWT never appears in the SSE URL.
      const url = await window.nexleyApi.chatStreamUrl(
        sendResp.conversation_id,
        sendResp.assistant_message_id
      );
      const es = new EventSource(url);

      let acc = '';
      const tools = [];
      let finished = false;
      const finish = (finalText) => {
        if (finished) return;
        finished = true;
        es.close();
        setMessages(m => [...m, {
          id: sendResp.assistant_message_id,
          role: 'ai',
          text: finalText || acc || '(no reply)',
          tools: tools.length > 0 ? tools : undefined,
          time: 'now',
        }]);
        setStreaming(false);
        setStreamText('');
      };

      es.addEventListener('token', (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.content) {
            acc += data.content;
            setStreamText(acc);
          }
        } catch {}
      });
      es.addEventListener('tool_use_start', (ev) => {
        try {
          const data = JSON.parse(ev.data);
          tools.push({ id: data.tool_use_id, label: humaniseTool(data.tool_name) });
        } catch {}
      });
      es.addEventListener('tool_result', (ev) => {
        try {
          const data = JSON.parse(ev.data);
          const t = tools.find(t => t.id === data.tool_use_id);
          if (t && data.ok) t.label = `${t.label} ✓`;
        } catch {}
      });
      es.addEventListener('message_complete', () => finish(acc));
      es.addEventListener('error', (ev) => {
        try {
          const data = JSON.parse(ev.data || '{}');
          finish(`[${data.code || 'error'}] ${data.message || 'Stream failed'}`);
        } catch {
          // EventSource native error event has no payload — fall back gracefully
          if (!finished) finish(acc || '[Connection lost]');
        }
      });
      // Safety net: 90s hard timeout
      setTimeout(() => { if (!finished) finish(acc || '[Timed out]'); }, 90_000);
    } catch (e) {
      setMessages(m => [...m, {
        id: 'err' + Date.now(), role: 'ai',
        text: `Couldn't reach the AI Employee: ${e.message || e}`,
        time: 'now',
      }]);
      setStreaming(false);
      setStreamText('');
    }
  };

  function humaniseTool(name) {
    return ({
      gmail_send_email: 'Sending email…',
      gmail_fetch_emails: 'Reading inbox…',
      calendar_find_event: 'Checking calendar…',
      calendar_create_event: 'Booking slot…',
      lookup_customer: 'Looking up customer…',
      create_estimate: 'Drafting estimate…',
      log_action: 'Logging action…',
    })[name] || name;
  }

  return (
    <div className="nx-screen">
      {/* Header */}
      <div className="hairline-b" style={{ padding: '6px 12px 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack} className="pressable" style={{ background: 'none', border: 'none', padding: 6, color: 'var(--fg)', display: 'flex' }}><I.ChevronLeft size={20} /></button>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ position: 'relative' }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--primary-soft)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 13, border: '0.5px solid var(--border)' }}>
              <I.Sparkles size={16} />
            </div>
            <span className="status-dot" style={{ position: 'absolute', right: -1, bottom: -1, width: 9, height: 9, border: '1.5px solid var(--bg)' }} />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>{aiName}</div>
            <div style={{ fontSize: 11, color: 'var(--muted-fg)' }}>your AI Employee · online</div>
          </div>
        </div>
        <button className="pressable" style={{ background: 'none', border: 'none', padding: 6, color: 'var(--muted-fg)' }}><I.More size={18} /></button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 6px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {messages.length === 0 && !streaming && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 12, paddingBottom: 4 }}>
            <div style={{ alignSelf: 'flex-start', maxWidth: '85%', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--primary)', fontWeight: 500 }}>
                <I.Sparkles size={11} /> {aiName}
              </div>
              <div style={{ background: 'var(--card)', border: '0.5px solid var(--border)', padding: '10px 13px', borderRadius: '14px 14px 14px 4px', fontSize: 14.5, lineHeight: 1.5, color: 'var(--fg)' }}>
                Hi Tom — I'm {aiName}. Ask me anything about your business. A few things I can help with right now:
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start', marginLeft: 4 }}>
              {[
                'Summarise this week',
                'Who\'s waiting on a reply?',
                'Draft a quote for Priya',
                'What jobs are booked tomorrow?',
              ].map((s) => (
                <button key={s} onClick={() => setInput(s)} className="pressable" style={{
                  padding: '7px 12px', borderRadius: 999, border: '0.5px solid var(--border)',
                  background: 'var(--card)', color: 'var(--fg)', fontSize: 12.5, fontFamily: 'inherit',
                  display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                }}>{s} <I.ArrowRight size={11} color="var(--muted-fg)" /></button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => <ChatBubble key={m.id} m={m} aiName={aiName} />)}
        {streaming && (
          <div className="bubble-in" style={{ alignSelf: 'flex-start', maxWidth: '82%' }}>
            <div style={{ background: 'var(--card)', border: '0.5px solid var(--border)', padding: '10px 13px', borderRadius: '14px 14px 14px 4px', fontSize: 14.5, lineHeight: 1.45 }}>
              {streamText || <span className="wave" style={{ color: 'var(--muted-fg)' }}><span/><span/><span/><span/><span/></span>}
              {streamText && <span className="caret" />}
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="hairline-t" style={{ padding: '10px 12px 14px', background: 'var(--bg)', display: 'flex', alignItems: 'flex-end', gap: 8 }}>
        <button className="pressable" style={{ width: 36, height: 36, borderRadius: '50%', border: '0.5px solid var(--border)', background: 'var(--card)', color: 'var(--fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><I.Plus size={18} /></button>
        <div style={{ flex: 1, background: 'var(--input)', borderRadius: 18, border: '0.5px solid var(--border)', padding: '8px 12px', minHeight: 36, display: 'flex', alignItems: 'center' }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && send()}
            placeholder={`Ask ${aiName} anything…`}
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--fg)', fontSize: 14.5, fontFamily: 'inherit' }}
          />
        </div>
        <button onClick={send} className="pressable" disabled={!input.trim() || streaming} style={{ width: 36, height: 36, borderRadius: '50%', border: 'none', background: input.trim() ? 'var(--primary)' : 'var(--muted)', color: input.trim() ? 'var(--primary-fg)' : 'var(--muted-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background 0.15s' }}><I.ArrowUp size={18} /></button>
      </div>
    </div>
  );
}

function ChatBubble({ m, aiName }) {
  if (m.role === 'owner') {
    return (
      <div className="bubble-in" style={{ alignSelf: 'flex-end', maxWidth: '82%' }}>
        <div style={{ background: 'var(--primary)', color: 'var(--primary-fg)', padding: '9px 13px', borderRadius: '14px 14px 4px 14px', fontSize: 14.5, lineHeight: 1.45 }}>{m.text}</div>
      </div>
    );
  }
  return (
    <div className="bubble-in" style={{ alignSelf: 'flex-start', maxWidth: '88%', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {m.tools && m.tools.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginLeft: 4 }}>
          {m.tools.map((t, i) => (
            <div key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--muted-fg)', whiteSpace: 'nowrap', maxWidth: '100%', overflow: 'hidden' }}>
              <I.Check size={11} color="var(--success)" />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.label}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ background: 'var(--card)', border: '0.5px solid var(--border)', padding: '10px 13px', borderRadius: '14px 14px 14px 4px', fontSize: 14.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', color: 'var(--fg)' }}>
        {m.text}
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--muted-fg)', marginLeft: 4 }}>{aiName} · {m.time}</div>
    </div>
  );
}

// ───────── CONVERSATION DETAIL (customer thread) ─────────
function ConversationDetailScreen({ aiName, conversationId, onBack }) {
  const M = window.NX_MOCK;
  const conv = (M.conversations || []).find(c => c.id === conversationId);
  const t = (M.threadsById && M.threadsById[conversationId])
    || (conv ? M.threadStub(conv) : M.thread);
  const [takenOver, setTakenOver] = NX_useState(false);
  const [showSheet, setShowSheet] = NX_useState(false);
  const [showHandbackSheet, setShowHandbackSheet] = NX_useState(false);
  const [draft, setDraft] = NX_useState('');
  const [thinking, setThinking] = NX_useState(false);

  // Simulate AI typing indicator briefly on mount
  NX_useEffect(() => {
    const tm = setTimeout(() => setThinking(false), 100);
    return () => clearTimeout(tm);
  }, []);

  const channelIcon = t.channel === 'whatsapp' ? <I.Whatsapp size={11} /> : (t.channel === 'sms' ? <I.Sms size={11} /> : <I.Voicemail size={11} />);
  const channelLabel = t.channel === 'whatsapp' ? 'WhatsApp' : (t.channel === 'sms' ? 'SMS' : 'Phone');
  const firstName = (t.customerName || '').split(' ')[0] || 'them';

  return (
    <div className="nx-screen">
      {/* Header */}
      <div className="hairline-b" style={{ padding: '6px 6px 10px', display: 'flex', alignItems: 'center', gap: 4 }}>
        <button onClick={onBack} className="pressable" style={{ background: 'none', border: 'none', padding: 6, color: 'var(--fg)', display: 'flex', flexShrink: 0 }}><I.ChevronLeft size={20} /></button>
        <Avatar initials={t.initials} size={32} />
        <div style={{ flex: 1, minWidth: 0, marginLeft: 8 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: '-0.01em', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {t.customerName}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--muted-fg)', fontWeight: 400, flexShrink: 0 }}>
              {channelIcon}{channelLabel}
            </span>
          </div>
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--muted-fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.phone}</div>
        </div>
        <button className="pressable" style={{ background: 'none', border: 'none', padding: 6, color: 'var(--muted-fg)', flexShrink: 0 }}><I.Phone size={17} /></button>
        <button className="pressable" style={{ background: 'none', border: 'none', padding: 6, color: 'var(--muted-fg)', flexShrink: 0 }}><I.More size={18} /></button>
      </div>

      {/* AI status banner */}
      {!takenOver && (
        <div style={{ padding: '7px 14px', background: 'var(--primary-soft)', borderBottom: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <I.Sparkles size={12} color="var(--primary)" />
          <div style={{ fontSize: 11.5, color: 'var(--fg)', flex: 1 }}>
            <span style={{ fontWeight: 500 }}>{aiName}</span>
            {(M.demoFlags && M.demoFlags.permissivePermissions)
              ? ' will reply automatically — no approval needed'
              : ' is handling this conversation'}
          </div>
          <span className="wave" style={{ color: 'var(--primary)' }}><span/><span/><span/><span/><span/></span>
        </div>
      )}

      {/* Thread */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* day separator */}
        <div style={{ alignSelf: 'center', fontSize: 10.5, color: 'var(--muted-fg)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '4px 10px', background: 'var(--muted)', borderRadius: 999 }}>Yesterday</div>

        {t.messages.map((m, idx) => {
          const showSep = idx === t.messages.length - 1; // before latest
          return (
            <React.Fragment key={m.id}>
              {showSep && (
                <div style={{ alignSelf: 'center', fontSize: 10.5, color: 'var(--muted-fg)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '4px 10px', background: 'var(--muted)', borderRadius: 999 }}>Today</div>
              )}
              <CustomerThreadBubble m={m} aiName={aiName} />
            </React.Fragment>
          );
        })}
      </div>

      {/* Take-over CTA / composer */}
      {!takenOver ? (
        <div className="hairline-t" style={{ padding: '12px 14px 16px', background: 'var(--bg)' }}>
          <button onClick={() => setShowSheet(true)} className="pressable" style={{ width: '100%', padding: '12px 16px', background: 'var(--primary)', color: 'var(--primary-fg)', border: 'none', borderRadius: 8, fontSize: 14.5, fontWeight: 500, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <I.Zap size={15} /> Take over the conversation
          </button>
          <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--muted-fg)', marginTop: 8 }}>
            {aiName} will reply to {firstName} next. You'll be notified if it escalates.
          </div>
        </div>
      ) : (
        <div className="hairline-t" style={{ padding: '10px 12px 14px', display: 'flex', alignItems: 'flex-end', gap: 8, background: 'var(--bg)' }}>
          <div style={{ flex: 1, background: 'var(--input)', borderRadius: 18, border: '0.5px solid var(--border)', padding: '8px 12px', minHeight: 36, display: 'flex', alignItems: 'center' }}>
            <input value={draft} onChange={e => setDraft(e.target.value)} placeholder={`Reply to ${firstName}…`} style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--fg)', fontSize: 14.5, fontFamily: 'inherit' }} />
          </div>
          <button onClick={() => setShowHandbackSheet(true)} className="pressable" style={{ padding: '0 12px', height: 36, borderRadius: 18, border: '0.5px solid var(--border)', background: 'var(--card)', color: 'var(--muted-fg)', fontSize: 12 }}>Hand back</button>
          <button className="pressable" style={{ width: 36, height: 36, borderRadius: '50%', border: 'none', background: draft.trim() ? 'var(--primary)' : 'var(--muted)', color: draft.trim() ? 'var(--primary-fg)' : 'var(--muted-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><I.ArrowUp size={18} /></button>
        </div>
      )}

      {/* Take-over sheet */}
      {showSheet && (
        <>
          <div onClick={() => setShowSheet(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 50, animation: 'nx-rise 200ms ease-out' }} />
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: 'var(--elevated)', borderRadius: '16px 16px 0 0', padding: '18px 20px 22px', zIndex: 51, boxShadow: 'var(--shadow-modal)', animation: 'nx-bubble-in 280ms cubic-bezier(0.32, 0.72, 0, 1)' }}>
            <div style={{ width: 36, height: 4, background: 'var(--border-strong)', borderRadius: 2, margin: '0 auto 14px' }} />
            <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.025em', color: 'var(--fg)' }}>Take over from {aiName}?</div>
            <div style={{ fontSize: 13, color: 'var(--muted-fg)', marginTop: 6, lineHeight: 1.5, textWrap: 'pretty' }}>
              You'll reply to {firstName} directly until you tap <span style={{ color: 'var(--fg)', fontWeight: 500 }}>Hand back</span>.
            </div>

            {/* What changes — three concrete bullets, the whole point */}
            <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--card)', border: '0.5px solid var(--border)', borderRadius: 11, display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                <span style={{ marginTop: 5, width: 5, height: 5, borderRadius: 999, background: 'var(--primary)', flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, color: 'var(--fg)', lineHeight: 1.5, textWrap: 'pretty' }}>{aiName} <strong style={{ fontWeight: 600 }}>stops sending</strong> messages on this thread.</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                <span style={{ marginTop: 5, width: 5, height: 5, borderRadius: 999, background: 'var(--primary)', flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, color: 'var(--fg)', lineHeight: 1.5, textWrap: 'pretty' }}>Suggestions <strong style={{ fontWeight: 600 }}>still appear</strong> above your composer — tap to use one.</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                <span style={{ marginTop: 5, width: 5, height: 5, borderRadius: 999, background: 'var(--primary)', flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, color: 'var(--fg)', lineHeight: 1.5, textWrap: 'pretty' }}>{firstName} sees <strong style={{ fontWeight: 600 }}>no notification</strong> — the handover is invisible to them.</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={() => setShowSheet(false)} className="pressable" style={{ flex: 1, padding: '12px', background: 'var(--card)', border: '0.5px solid var(--border)', borderRadius: 8, fontSize: 14, color: 'var(--fg)' }}>Cancel</button>
              <button onClick={() => { setTakenOver(true); setShowSheet(false); }} className="pressable" style={{ flex: 1, padding: '12px', background: 'var(--primary)', color: 'var(--primary-fg)', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500 }}>Take over</button>
            </div>
          </div>
        </>
      )}

      {/* Hand-back sheet — symmetric to take-over: explain what changes back. */}
      {showHandbackSheet && (
        <>
          <div onClick={() => setShowHandbackSheet(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 50, animation: 'nx-rise 200ms ease-out' }} />
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: 'var(--elevated)', borderRadius: '16px 16px 0 0', padding: '18px 20px 22px', zIndex: 51, boxShadow: 'var(--shadow-modal)', animation: 'nx-bubble-in 280ms cubic-bezier(0.32, 0.72, 0, 1)' }}>
            <div style={{ width: 36, height: 4, background: 'var(--border-strong)', borderRadius: 2, margin: '0 auto 14px' }} />
            <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.025em', color: 'var(--fg)' }}>Hand back to {aiName}?</div>
            <div style={{ fontSize: 13, color: 'var(--muted-fg)', marginTop: 6, lineHeight: 1.5, textWrap: 'pretty' }}>
              {aiName} will pick up where you left off. Your last reply stays in the thread — {firstName} won't see anything change.
            </div>

            <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--card)', border: '0.5px solid var(--border)', borderRadius: 11, display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                <span style={{ marginTop: 5, width: 5, height: 5, borderRadius: 999, background: 'var(--primary)', flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, color: 'var(--fg)', lineHeight: 1.5, textWrap: 'pretty' }}>{aiName} <strong style={{ fontWeight: 600 }}>resumes</strong> replying on this thread.</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                <span style={{ marginTop: 5, width: 5, height: 5, borderRadius: 999, background: 'var(--primary)', flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, color: 'var(--fg)', lineHeight: 1.5, textWrap: 'pretty' }}>It <strong style={{ fontWeight: 600 }}>re-reads</strong> the conversation so it picks up your tone.</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                <span style={{ marginTop: 5, width: 5, height: 5, borderRadius: 999, background: 'var(--primary)', flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, color: 'var(--fg)', lineHeight: 1.5, textWrap: 'pretty' }}>You'll be <strong style={{ fontWeight: 600 }}>pinged</strong> if anything needs your sign-off again.</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={() => setShowHandbackSheet(false)} className="pressable" style={{ flex: 1, padding: '12px', background: 'var(--card)', border: '0.5px solid var(--border)', borderRadius: 8, fontSize: 14, color: 'var(--fg)' }}>Cancel</button>
              <button onClick={() => { setTakenOver(false); setShowHandbackSheet(false); }} className="pressable" style={{ flex: 1, padding: '12px', background: 'var(--primary)', color: 'var(--primary-fg)', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500 }}>Hand back</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function CustomerThreadBubble({ m, aiName }) {
  if (m.role === 'customer') {
    return (
      <div className="bubble-in" style={{ alignSelf: 'flex-start', maxWidth: '82%' }}>
        <div style={{ background: 'var(--card)', border: '0.5px solid var(--border)', padding: '9px 12px', borderRadius: '14px 14px 14px 4px', fontSize: 14, lineHeight: 1.45 }}>{m.text}</div>
        <div style={{ fontSize: 10.5, color: 'var(--muted-fg)', marginLeft: 6, marginTop: 3 }}>{m.time}</div>
      </div>
    );
  }
  // AI
  return (
    <div className="bubble-in" style={{ alignSelf: 'flex-end', maxWidth: '85%', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--primary)', fontWeight: 500 }}>
        <I.Sparkles size={11} /> {aiName}
      </div>
      {m.tools && m.tools.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
          {m.tools.map((t, i) => (
            <div key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--muted-fg)', padding: '2px 8px', background: 'var(--muted)', borderRadius: 999, whiteSpace: 'nowrap' }}>
              <I.Check size={10} color="var(--success)" />{t.label}
            </div>
          ))}
        </div>
      )}
      <div style={{ background: 'var(--primary-soft)', border: '0.5px solid var(--primary)', borderColor: 'color-mix(in oklch, var(--primary) 30%, transparent)', padding: '9px 12px', borderRadius: '14px 14px 4px 14px', fontSize: 14, lineHeight: 1.5, color: 'var(--fg)' }}>
        {m.text}
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--muted-fg)', marginRight: 6 }}>{m.time}</div>
    </div>
  );
}

// ───────── INBOX (used in prototype) ─────────
function InboxScreen({ onOpenConversation, onBack }) {
  const M = window.NX_MOCK;
  const fresh = !!(M.demoFlags && M.demoFlags.freshOnboarding);
  const [filter, setFilter] = NX_useState('all');
  const filters = [
    { id: 'all', label: 'All' },
    { id: 'awaiting_reply', label: 'Awaiting' },
    { id: 'booked', label: 'Booked' },
    { id: 'closed', label: 'Closed' },
  ];
  const visible = fresh ? [] : M.conversations.filter(c => filter === 'all' || c.status === filter);

  const channelIcon = (ch) => ({
    whatsapp: <I.Whatsapp size={11} color="var(--success)" />,
    sms: <I.Sms size={11} color="var(--muted-fg)" />,
    phone: <I.Voicemail size={11} color="var(--muted-fg)" />,
  }[ch]);

  return (
    <div className="nx-screen">
      <div style={{ padding: '4px 16px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.025em' }}>Inbox</div>
        <button className="pressable" style={{ width: 36, height: 36, borderRadius: '50%', border: '0.5px solid var(--border)', background: 'var(--card)', color: 'var(--fg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><I.Search size={16} /></button>
      </div>
      <div style={{ display: 'flex', gap: 6, padding: '4px 16px 12px', overflowX: 'auto' }}>
        {filters.map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} className="pressable" style={{ flexShrink: 0, padding: '6px 11px', borderRadius: 999, fontSize: 12.5, border: '0.5px solid', borderColor: filter === f.id ? 'var(--primary)' : 'var(--border)', background: filter === f.id ? 'var(--primary)' : 'transparent', color: filter === f.id ? 'var(--primary-fg)' : 'var(--fg)' }}>{f.label}</button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {visible.length === 0 && (
          <div style={{ padding: '48px 28px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted-fg)', marginBottom: 4 }}>
              <I.Inbox size={20} />
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--fg)' }}>
              {fresh ? 'No conversations yet' : 'Nothing here'}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--muted-fg)', lineHeight: 1.5, maxWidth: 240, textWrap: 'pretty' }}>
              {fresh
                ? 'Once you connect WhatsApp or another channel, customer messages will land here.'
                : `No ${filter === 'all' ? 'conversations' : filters.find(f => f.id === filter)?.label.toLowerCase()} match this filter.`}
            </div>
          </div>
        )}
        {visible.map((c, i) => (
          <button key={c.id} type="button" onClick={() => onOpenConversation(c.id)} className="pressable" style={{ display: 'flex', gap: 11, padding: '11px 16px', borderTop: i === 0 ? 'none' : '0.5px solid var(--border)', alignItems: 'center', width: '100%', background: 'none', border: 'none', borderRadius: 0, textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer' }}>
            <div style={{ position: 'relative' }}>
              <Avatar initials={c.initials} size={40} />
              <div style={{ position: 'absolute', right: -1, bottom: -1, width: 14, height: 14, borderRadius: '50%', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{channelIcon(c.channel)}</div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <div style={{ fontSize: 14.5, fontWeight: c.unread > 0 ? 600 : 500, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--muted-fg)', flexShrink: 0 }}>{c.time}</div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 2 }}>
                <div style={{ fontSize: 12.5, color: c.unread > 0 ? 'var(--fg)' : 'var(--muted-fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.preview}</div>
                {c.unread > 0 && <div style={{ background: 'var(--primary)', color: 'var(--primary-fg)', fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 999, minWidth: 16, textAlign: 'center', flexShrink: 0 }}>{c.unread}</div>}
                {c.status === 'awaiting_reply' && c.unread === 0 && <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--warning)', flexShrink: 0 }} />}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ───────── TAB BAR ─────────
function TabBar({ tab, onChange }) {
  const tabs = [
    { id: 'home', icon: I.Home, label: 'Home' },
    { id: 'inbox', icon: I.Inbox, label: 'Inbox' },
    { id: 'chat', icon: I.Sparkles, label: 'Chat' },
    { id: 'integrations', icon: I.Plug, label: 'Apps' },
    { id: 'settings', icon: I.Settings, label: 'Settings' },
  ];
  return (
    <div className="hairline-t" style={{ display: 'flex', justifyContent: 'space-around', padding: '8px 4px 6px', background: 'var(--bg)', flexShrink: 0 }}>
      {tabs.map(t => {
        const Ic = t.icon;
        const active = tab === t.id;
        return (
          <button key={t.id} onClick={() => onChange(t.id)} className={`pressable ${active ? 'tab-active' : ''}`} style={{ position: 'relative', flex: 1, background: 'none', border: 'none', padding: '6px 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, color: active ? 'var(--primary)' : 'var(--muted-fg)' }}>
            <Ic size={20} strokeWidth={active ? 1.85 : 1.5} />
            <span style={{ fontSize: 10, fontWeight: active ? 500 : 400 }}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// Expose
Object.assign(window, { HomeScreen, OwnerChatScreen, ConversationDetailScreen, InboxScreen, TabBar, Avatar });
