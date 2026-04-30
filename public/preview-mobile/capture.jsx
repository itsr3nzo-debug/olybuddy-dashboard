// Nexley Mobile — Capture feature screens
// Photo → AI Vision → Confirm action flow.
//
// Five screens (rendered conditionally based on captureRoute.step):
//   - 'mode'        — Document or Photo picker bottom sheet
//   - 'preview'     — Thumbnails + optional context + Continue
//   - 'processing'  — Photo at 80% opacity + shimmer + microcopy
//   - 'confirm'     — Classification + extracted fields + primary CTA
//   - 'toast'       — 4s "Logged £247.18" then back to Home
//
// Composes with the existing iOS phone shell.

const NXC_useState = React.useState;
const NXC_useEffect = React.useEffect;
const NXC_useRef = React.useRef;
const ICAP = window.Icons;

// ────────────────────── Capture FAB (rendered on Home) ──────────────────────

function CaptureFAB({ onPress }) {
  return (
    <button
      onClick={onPress}
      aria-label="Capture"
      className="pressable"
      style={{
        position: 'absolute',
        right: 16,
        bottom: 76,
        width: 52,
        height: 52,
        borderRadius: '50%',
        background: 'var(--card)',
        border: '0.5px solid var(--border)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.18), 0 1px 2px rgba(0,0,0,0.12)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--fg)',
        cursor: 'pointer',
        zIndex: 5,
      }}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 4h-5L7 6.5H4a2 2 0 0 0-2 2V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8.5a2 2 0 0 0-2-2h-3L14.5 4z"/>
        <circle cx="12" cy="13" r="3.5"/>
      </svg>
    </button>
  );
}

// ────────────────────── Mode Picker bottom sheet ──────────────────────

function CaptureModePicker({ onSelect, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute', inset: 0, zIndex: 30,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex', alignItems: 'flex-end',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          background: 'var(--card)',
          borderTopLeftRadius: 16, borderTopRightRadius: 16,
          padding: '20px 16px 28px',
          borderTop: '0.5px solid var(--border)',
        }}
      >
        <div style={{
          width: 36, height: 4, borderRadius: 2,
          background: 'var(--border)',
          margin: '0 auto 16px',
        }} />
        <p style={{
          fontSize: 11, fontWeight: 500,
          letterSpacing: '0.08em', textTransform: 'uppercase',
          color: 'var(--muted-fg)', marginBottom: 12,
        }}>Capture</p>

        <button
          onClick={() => onSelect('document')}
          className="pressable"
          style={{
            width: '100%', padding: '14px 12px',
            display: 'flex', alignItems: 'center', gap: 14,
            background: 'transparent', border: 'none',
            borderRadius: 8, cursor: 'pointer',
            color: 'var(--fg)', textAlign: 'left',
          }}
        >
          <span style={{
            width: 36, height: 36, borderRadius: 8,
            background: 'var(--bg-3)', border: '0.5px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <path d="M14 2v6h6"/>
              <path d="M9 13h6"/>
              <path d="M9 17h6"/>
            </svg>
          </span>
          <span>
            <span style={{ display: 'block', fontSize: 15, fontWeight: 500 }}>Document</span>
            <span style={{ display: 'block', fontSize: 12.5, color: 'var(--muted-fg)', marginTop: 2 }}>
              Receipts, invoices, paper estimates
            </span>
          </span>
        </button>

        <button
          onClick={() => onSelect('photo')}
          className="pressable"
          style={{
            width: '100%', padding: '14px 12px',
            display: 'flex', alignItems: 'center', gap: 14,
            background: 'transparent', border: 'none',
            borderRadius: 8, cursor: 'pointer',
            color: 'var(--fg)', textAlign: 'left',
          }}
        >
          <span style={{
            width: 36, height: 36, borderRadius: 8,
            background: 'var(--bg-3)', border: '0.5px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.5 4h-5L7 6.5H4a2 2 0 0 0-2 2V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8.5a2 2 0 0 0-2-2h-3L14.5 4z"/>
              <circle cx="12" cy="13" r="3.5"/>
            </svg>
          </span>
          <span>
            <span style={{ display: 'block', fontSize: 15, fontWeight: 500 }}>Photo</span>
            <span style={{ display: 'block', fontSize: 12.5, color: 'var(--muted-fg)', marginTop: 2 }}>
              Job site, appliance, distribution board
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}

// ────────────────────── Preview screen (thumbs + context + continue) ──────────────────────

function CapturePreviewScreen({ photos, onAddMore, onRetake, onDelete, onContinue, onBack }) {
  const [contextHint, setContextHint] = NXC_useState('');

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', borderBottom: '0.5px solid var(--border)',
      }}>
        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', color: 'var(--fg)', fontSize: 14, padding: 6, cursor: 'pointer' }}
        >
          ←
        </button>
        <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--fg)' }}>Review photos</span>
        <button
          onClick={() => onContinue(contextHint)}
          disabled={photos.length === 0}
          style={{
            background: 'none', border: 'none',
            color: photos.length === 0 ? 'var(--muted-fg)' : 'var(--primary)',
            fontSize: 14, fontWeight: 500, padding: 6,
            cursor: photos.length === 0 ? 'default' : 'pointer',
          }}
        >
          Continue
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {/* Thumbs strip */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8 }}>
          {photos.map((p, i) => (
            <div key={i} style={{ position: 'relative', flexShrink: 0 }}>
              <img
                src={p.dataUrl}
                alt={`Photo ${i + 1}`}
                style={{
                  width: 80, height: 100, objectFit: 'cover',
                  borderRadius: 6, border: '0.5px solid var(--border)',
                  background: 'var(--bg-3)',
                }}
              />
              <button
                onClick={() => onDelete(i)}
                style={{
                  position: 'absolute', top: -6, right: -6,
                  width: 20, height: 20, borderRadius: '50%',
                  background: 'var(--card)', border: '0.5px solid var(--border)',
                  color: 'var(--fg)', fontSize: 11, lineHeight: 1,
                  cursor: 'pointer',
                }}
              >×</button>
            </div>
          ))}
          <button
            onClick={onAddMore}
            style={{
              width: 80, height: 100, flexShrink: 0,
              borderRadius: 6,
              border: '1px dashed var(--border)',
              background: 'transparent',
              color: 'var(--muted-fg)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, cursor: 'pointer',
            }}
            aria-label="Add photo"
          >+</button>
        </div>

        {/* Context input */}
        <div style={{ marginTop: 24 }}>
          <label style={{
            display: 'block', fontSize: 11, fontWeight: 500,
            letterSpacing: '0.08em', textTransform: 'uppercase',
            color: 'var(--muted-fg)', marginBottom: 8,
          }}>What's this for? (optional)</label>
          <input
            type="text"
            value={contextHint}
            onChange={(e) => setContextHint(e.target.value)}
            placeholder="e.g. Smith bathroom"
            style={{
              width: '100%', padding: '10px 12px',
              background: 'var(--card)', color: 'var(--fg)',
              border: '0.5px solid var(--border)', borderRadius: 8,
              fontSize: 14, fontFamily: 'inherit', outline: 'none',
            }}
          />
          <p style={{ marginTop: 6, fontSize: 11, color: 'var(--muted-fg)' }}>
            Helps the AI link this to the right job or customer.
          </p>
        </div>
      </div>

      {/* Bottom CTA */}
      <div style={{ padding: 16, borderTop: '0.5px solid var(--border)' }}>
        <button
          onClick={() => onContinue(contextHint)}
          disabled={photos.length === 0}
          className="pressable"
          style={{
            width: '100%', padding: 14,
            background: photos.length === 0 ? 'var(--bg-3)' : 'var(--fg)',
            color: photos.length === 0 ? 'var(--muted-fg)' : 'var(--bg)',
            border: 'none', borderRadius: 8,
            fontSize: 15, fontWeight: 500,
            cursor: photos.length === 0 ? 'default' : 'pointer',
          }}
        >
          {photos.length === 0 ? 'Add at least one photo' : `Continue with ${photos.length} photo${photos.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  );
}

// ────────────────────── Processing shimmer ──────────────────────

function CaptureProcessingScreen({ photo }) {
  const [microcopyIdx, setMicrocopyIdx] = NXC_useState(0);
  const microcopy = [
    'Reading your photo…',
    'Pulling out the details…',
    'Looking for amounts…',
    'Almost there…',
  ];
  NXC_useEffect(() => {
    const t = setInterval(() => setMicrocopyIdx((i) => (i + 1) % microcopy.length), 1600);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', padding: 24, position: 'relative',
    }}>
      <div style={{ position: 'relative', width: 200, height: 260 }}>
        <img
          src={photo}
          alt=""
          style={{
            width: '100%', height: '100%', objectFit: 'cover',
            borderRadius: 10, opacity: 0.55,
            border: '0.5px solid var(--border)',
          }}
        />
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 10,
          background: 'linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.18) 50%, transparent 70%)',
          backgroundSize: '200% 100%',
          animation: 'capture-shimmer 1.6s ease-in-out infinite',
        }} />
      </div>
      <p style={{
        marginTop: 28, fontSize: 14, color: 'var(--muted-fg)',
        transition: 'opacity 0.3s', minHeight: 18,
      }}>
        {microcopy[microcopyIdx]}
      </p>

      <style>{`
        @keyframes capture-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}

// ────────────────────── Confirm card ──────────────────────

function CaptureConfirmScreen({ result, photo, onCommit, onRetry, onBack }) {
  const [editedFields, setEditedFields] = NXC_useState(result.extracted || {});
  const [committing, setCommitting] = NXC_useState(false);

  const action = result.suggested_action || {};
  const ctaLabel = action.cta_label || 'Confirm';
  const classificationLabel =
    {
      invoice: 'an invoice',
      receipt: 'a receipt',
      business_card: 'a business card',
      estimate: 'an estimate',
      distribution_board: 'a distribution board',
      job_site: 'a job site photo',
      screenshot_sms: 'a customer message',
      delivery_note: 'a delivery note',
      calendar_page: 'a calendar page',
      other: 'something to look at',
    }[result.classification] || result.classification;

  // Render extracted fields as editable rows
  const fieldRows = renderFields(result.classification, editedFields, (k, v) => {
    setEditedFields((prev) => ({ ...prev, [k]: v }));
  });

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', borderBottom: '0.5px solid var(--border)',
      }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--fg)', fontSize: 14, padding: 6, cursor: 'pointer' }}>←</button>
        <span style={{ fontSize: 15, fontWeight: 500 }}>Confirm</span>
        <span style={{ width: 24 }} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {/* Hero */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 20 }}>
          <img
            src={photo}
            alt=""
            style={{
              width: 70, height: 90, objectFit: 'cover',
              borderRadius: 6, flexShrink: 0,
              border: '0.5px solid var(--border)',
            }}
          />
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 11, color: 'var(--muted-fg)', letterSpacing: '0.04em' }}>WE SEE</p>
            <p style={{ marginTop: 4, fontSize: 17, fontWeight: 500, lineHeight: 1.3 }}>
              {classificationLabel}
              {result.confidence < 0.7 && (
                <span style={{ color: 'var(--muted-fg)', fontSize: 12, marginLeft: 6 }}>
                  ({Math.round(result.confidence * 100)}% sure)
                </span>
              )}
            </p>
            {result.confidence < 0.7 && result.ambiguous_alternatives?.length > 0 && (
              <button
                onClick={() => onRetry(result.ambiguous_alternatives[0])}
                style={{ marginTop: 6, fontSize: 12, color: 'var(--primary)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
              >
                Could be {result.ambiguous_alternatives[0].replace(/_/g, ' ')}? Re-read
              </button>
            )}
          </div>
        </div>

        {/* Editable fields */}
        <div style={{ background: 'var(--card)', border: '0.5px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {fieldRows}
        </div>

        <p style={{ marginTop: 14, fontSize: 11, color: 'var(--muted-fg)' }}>
          Tap any field to edit before committing.
        </p>
      </div>

      {/* Bottom CTA */}
      <div style={{ padding: 16, borderTop: '0.5px solid var(--border)' }}>
        <button
          onClick={async () => { setCommitting(true); await onCommit(editedFields); setCommitting(false); }}
          disabled={committing}
          className="pressable"
          style={{
            width: '100%', padding: 14,
            background: 'var(--fg)', color: 'var(--bg)',
            border: 'none', borderRadius: 8,
            fontSize: 15, fontWeight: 500,
            cursor: committing ? 'default' : 'pointer',
          }}
        >
          {committing ? 'Working…' : ctaLabel}
        </button>
        <button
          onClick={onBack}
          style={{
            width: '100%', marginTop: 8, padding: 10,
            background: 'transparent', color: 'var(--muted-fg)',
            border: 'none', fontSize: 13, cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function renderFields(classification, fields, onEdit) {
  const rows = [];
  const order = fieldOrderFor(classification);

  for (const key of order) {
    if (!(key in fields)) continue;
    const value = fields[key];
    if (value === null || value === undefined) continue;
    rows.push(
      <FieldRow
        key={key}
        label={labelFor(key)}
        value={value}
        format={formatFor(key)}
        onChange={(v) => onEdit(key, v)}
      />
    );
  }

  return rows;
}

function FieldRow({ label, value, format, onChange }) {
  const [editing, setEditing] = NXC_useState(false);
  const display = format ? format(value) : String(value ?? '');
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start',
      padding: '12px 14px',
      borderBottom: '0.5px solid var(--border)',
      gap: 12,
    }}>
      <span style={{ fontSize: 12.5, color: 'var(--muted-fg)', minWidth: 80, paddingTop: 2 }}>{label}</span>
      <div style={{ flex: 1, fontSize: 13.5 }}>
        {editing ? (
          <input
            value={typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')}
            onChange={(e) => onChange(parseInputValue(e.target.value, value))}
            onBlur={() => setEditing(false)}
            autoFocus
            style={{
              width: '100%', background: 'transparent', color: 'var(--fg)',
              border: '0.5px solid var(--primary)', borderRadius: 4,
              padding: 4, fontFamily: 'inherit', fontSize: 13.5, outline: 'none',
            }}
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            style={{
              background: 'none', border: 'none', color: 'var(--fg)',
              fontFamily: 'inherit', fontSize: 13.5, textAlign: 'left',
              padding: 0, cursor: 'pointer',
              fontVariantNumeric: ['total_pence', 'vat_pence', 'unit_price_pence'].some(k => label.toLowerCase().includes(k.replace(/_pence/, ''))) ? 'tabular-nums' : 'normal',
            }}
          >
            {display}
          </button>
        )}
      </div>
    </div>
  );
}

function parseInputValue(text, original) {
  if (typeof original === 'number') {
    const n = parseFloat(text);
    return Number.isNaN(n) ? original : n;
  }
  if (typeof original === 'object' && original !== null) {
    try { return JSON.parse(text); } catch { return original; }
  }
  return text;
}

function fieldOrderFor(classification) {
  switch (classification) {
    case 'invoice':
    case 'receipt':
      return ['supplier', 'date', 'total_pence', 'vat_pence', 'line_items', 'suggested_job_link'];
    case 'business_card':
      return ['name', 'phone', 'email', 'company', 'role', 'address'];
    case 'estimate':
      return ['customer_name', 'total_pence', 'line_items', 'notes'];
    case 'distribution_board':
      return ['phase', 'circuits', 'make'];
    case 'job_site':
      return ['description', 'hazards', 'suggested_question_for_ai'];
    case 'screenshot_sms':
      return ['sender_name', 'sender_phone', 'message', 'suggested_reply'];
    case 'delivery_note':
      return ['supplier', 'items', 'date'];
    case 'calendar_page':
      return ['bookings'];
    default:
      return ['description'];
  }
}

function labelFor(key) {
  return key.replace(/_pence$/, '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function formatFor(key) {
  if (key === 'total_pence' || key === 'vat_pence' || key === 'unit_price_pence') {
    return (v) => typeof v === 'number' ? `£${(v / 100).toFixed(2)}` : String(v);
  }
  if (key === 'line_items' || key === 'circuits' || key === 'items' || key === 'bookings' || key === 'hazards') {
    return (v) => Array.isArray(v) ? `${v.length} item${v.length === 1 ? '' : 's'}` : String(v);
  }
  if (key === 'date') {
    return (v) => {
      try { return new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
      catch { return String(v); }
    };
  }
  return null;
}

// ────────────────────── Action toast ──────────────────────

function CaptureActionToast({ message, onDismiss }) {
  NXC_useEffect(() => {
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div style={{
      position: 'absolute', left: 12, right: 12, bottom: 76,
      background: 'var(--fg)', color: 'var(--bg)',
      padding: '12px 14px', borderRadius: 10,
      display: 'flex', alignItems: 'center', gap: 10,
      boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
      fontSize: 13.5, zIndex: 40,
      animation: 'capture-toast-in 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
    }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      <span style={{ flex: 1 }}>{message}</span>
      <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: 'inherit', opacity: 0.6, fontSize: 14, padding: 4, cursor: 'pointer' }}>×</button>
      <style>{`
        @keyframes capture-toast-in {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ────────────────────── Container — orchestrates the whole flow ──────────────────────

function CaptureFlow({ onClose, onComplete, apiBase, jwt }) {
  const [step, setStep] = NXC_useState('mode'); // 'mode' | 'capture' | 'preview' | 'processing' | 'confirm' | 'toast'
  const [mode, setMode] = NXC_useState(null); // 'document' | 'photo'
  const [photos, setPhotos] = NXC_useState([]); // [{ file, dataUrl }]
  const [contextHint, setContextHint] = NXC_useState('');
  const [captureId, setCaptureId] = NXC_useState(null);
  const [extraction, setExtraction] = NXC_useState(null);
  const [error, setError] = NXC_useState(null);
  const [toastMsg, setToastMsg] = NXC_useState(null);
  const fileInputRef = NXC_useRef(null);

  const handleSelectMode = (m) => {
    setMode(m);
    fileInputRef.current?.click();
  };

  const handleFiles = async (files) => {
    if (!files || files.length === 0) return;
    const newPhotos = [];
    for (const f of files) {
      const dataUrl = await readAsDataURL(f);
      newPhotos.push({ file: f, dataUrl });
    }
    setPhotos((p) => [...p, ...newPhotos]);
    setStep('preview');
  };

  const handleContinue = async (hint) => {
    setContextHint(hint);
    setStep('processing');

    if (!apiBase || !jwt) {
      // Mock-mode fallback — show a fake result after 2s for demo
      await new Promise((r) => setTimeout(r, 2200));
      setExtraction(mockExtraction(photos));
      setStep('confirm');
      return;
    }

    try {
      // Real API path: upload → process
      const fd = new FormData();
      photos.forEach((p) => fd.append('photos', p.file));
      if (hint) fd.append('context_hint', hint);
      const upload = await fetch(`${apiBase}/api/mobile/capture/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}` },
        body: fd,
      });
      if (!upload.ok) {
        const err = await upload.json().catch(() => ({}));
        throw new Error(err.message || `Upload failed (${upload.status})`);
      }
      const { capture_id } = await upload.json();
      setCaptureId(capture_id);

      const proc = await fetch(`${apiBase}/api/mobile/capture/${capture_id}/process`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          'Idempotency-Key': `process-${capture_id}-${Date.now()}`,
        },
      });
      if (!proc.ok) {
        const err = await proc.json().catch(() => ({}));
        throw new Error(err.message || `Process failed (${proc.status})`);
      }
      const result = await proc.json();
      setExtraction(result);
      setStep('confirm');
    } catch (e) {
      setError(e.message);
      setStep('preview');
    }
  };

  const handleCommit = async (editedFields) => {
    if (!apiBase || !jwt) {
      // Mock mode: just show the toast and dismiss
      setToastMsg(extraction.suggested_action.cta_label);
      setStep('toast');
      return;
    }
    try {
      const res = await fetch(`${apiBase}/api/mobile/capture/${captureId}/commit`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `commit-${captureId}`,
        },
        body: JSON.stringify({
          action_type: extraction.suggested_action.type,
          params: extraction.suggested_action.params,
          edits: editedFields,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Commit failed (${res.status})`);
      }
      setToastMsg(extraction.suggested_action.cta_label);
      setStep('toast');
    } catch (e) {
      setError(e.message);
    }
  };

  const handleRetry = async (newHint) => {
    if (!captureId) return;
    setStep('processing');
    try {
      const res = await fetch(`${apiBase}/api/mobile/capture/${captureId}/process?retry_with_hint=${encodeURIComponent(newHint)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}` },
      });
      const data = await res.json();
      setExtraction(data);
      setStep('confirm');
    } catch (e) {
      setError(e.message);
      setStep('confirm');
    }
  };

  const handleToastDismiss = () => {
    onComplete?.(toastMsg);
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture={mode === 'photo' ? 'environment' : undefined}
        multiple
        style={{ display: 'none' }}
        onChange={(e) => handleFiles(e.target.files)}
      />

      {step === 'mode' && (
        <CaptureModePicker onSelect={handleSelectMode} onClose={onClose} />
      )}

      {step === 'preview' && (
        <CapturePreviewScreen
          photos={photos}
          onAddMore={() => fileInputRef.current?.click()}
          onRetake={() => {}}
          onDelete={(i) => setPhotos((p) => p.filter((_, idx) => idx !== i))}
          onContinue={handleContinue}
          onBack={onClose}
        />
      )}

      {step === 'processing' && photos.length > 0 && (
        <CaptureProcessingScreen photo={photos[0].dataUrl} />
      )}

      {step === 'confirm' && extraction && (
        <CaptureConfirmScreen
          result={extraction}
          photo={photos[0]?.dataUrl}
          onCommit={handleCommit}
          onRetry={handleRetry}
          onBack={() => setStep('preview')}
        />
      )}

      {step === 'toast' && (
        <CaptureActionToast message={toastMsg} onDismiss={handleToastDismiss} />
      )}

      {error && (
        <div style={{
          position: 'absolute', left: 16, right: 16, top: 60,
          background: 'var(--destructive)', color: 'white',
          padding: '10px 12px', borderRadius: 8,
          fontSize: 13, zIndex: 50,
        }}>
          {error}
          <button onClick={() => setError(null)} style={{ marginLeft: 12, background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>×</button>
        </div>
      )}
    </>
  );
}

// ────────────────────── Helpers ──────────────────────

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function mockExtraction(photos) {
  // Demo data when no JWT is set — pretend we saw an invoice
  return {
    capture_id: 'mock-' + Date.now(),
    classification: 'invoice',
    confidence: 0.94,
    extracted: {
      supplier: 'Travis Perkins',
      date: new Date().toISOString().slice(0, 10),
      total_pence: 24718,
      vat_pence: 4118,
      line_items: [
        { description: '14mm twin & earth (50m)', quantity: 1, unit_price_pence: 8990 },
        { description: '20A MCB Type B', quantity: 4, unit_price_pence: 1295 },
        { description: 'Misc fittings', quantity: 1, unit_price_pence: 6548 },
      ],
    },
    suggested_action: {
      type: 'log_expense',
      params: { supplier: 'Travis Perkins', total_pence: 24718, date: new Date().toISOString().slice(0, 10) },
      cta_label: 'Log expense £247.18',
    },
  };
}

// Expose to window so index.html can use them
Object.assign(window, { CaptureFAB, CaptureFlow });
