import React, { useState, useEffect } from 'react';
import { Highlight, themes, type Language, type PrismTheme } from 'prism-react-renderer';
import { useTheme } from 'next-themes';

/**
 * Tiny markdown renderer — handles the subset the mock data uses:
 * headings (# ## ###), bold **, inline code `, links, lists (ul+ol), tables,
 * blockquote, code fences ``` and paragraphs.
 */

// Languages we pattern-match and hand to Prism. Anything else falls back to
// Prism's `clike` grammar, which still tokenises reasonably. Prism supports
// ~20 out of the box; we don't ship dynamic language loading.
const PRISM_LANG_MAP: Record<string, Language> = {
  js: 'jsx', javascript: 'jsx', jsx: 'jsx',
  ts: 'tsx', typescript: 'tsx', tsx: 'tsx',
  json: 'json', yaml: 'yaml', yml: 'yaml',
  python: 'python', py: 'python',
  ruby: 'ruby', rb: 'ruby',
  go: 'go', rust: 'rust',
  sql: 'sql',
  bash: 'bash', sh: 'bash', shell: 'bash', zsh: 'bash',
  css: 'css', scss: 'scss', html: 'markup', xml: 'markup',
  diff: 'diff', md: 'markdown', markdown: 'markdown',
};

/**
 * Code-fence block with a header strip showing the language + copy button,
 * and Prism token-level syntax highlighting. prism-react-renderer is ~15kb
 * tree-shaken, handles ~20 languages, and themes via a simple token map.
 */
function CodeBlock({ lang, body }: { lang?: string; body: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* no-op */ }
  };
  const lowered = (lang || '').toLowerCase().trim();
  const prismLang: Language = (PRISM_LANG_MAP[lowered] || 'clike') as Language;
  // Theme detection via next-themes — avoids the SSR hydration mismatch
  // we'd get from peeking at `document.querySelector('.nexley-chat-root')`
  // during render. `mounted` guard means we render light-theme tokens on
  // the server + first client frame, then swap to dark on the second
  // frame if that's what the user picked. Single-frame flash acceptable;
  // DOM mismatch never.
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const theme: PrismTheme = (mounted && resolvedTheme === 'dark') ? themes.vsDark : themes.github;
  return (
    <div
      className="my-3 rounded-md overflow-hidden group"
      style={{ border: '1px solid rgb(var(--hy-border))' }}
    >
      <div
        className="flex items-center justify-between px-3 h-7 text-[10.5px] fg-muted uppercase tracking-wider"
        style={{ borderBottom: '1px solid rgb(var(--hy-border))', background: 'rgb(var(--hy-bg-hover) / 0.4)' }}
      >
        <span>{lowered || 'code'}</span>
        <button
          onClick={onCopy}
          className="text-[10.5px] fg-muted hover:fg-base transition-colors px-1 py-0.5 rounded focus-ring"
          aria-label="Copy code"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <Highlight code={body} language={prismLang} theme={theme}>
        {({ className, style, tokens, getLineProps, getTokenProps }) => (
          <pre
            className={`${className} overflow-x-auto px-3 py-2 text-[12.5px]`}
            style={{ ...style, fontFamily: 'var(--font-mono)', margin: 0, background: 'transparent' }}
          >
            {tokens.map((line, i) => {
              // Destructure off any `key` from the props object — React
              // warns about receiving `key` via spread in strict mode.
              const { key: _lk, ...lineRest } = getLineProps({ line }) as Record<string, unknown> & { key?: React.Key };
              void _lk;
              return (
                <div key={i} {...lineRest}>
                  {line.map((token, k) => {
                    const { key: _tk, ...tokenRest } = getTokenProps({ token }) as Record<string, unknown> & { key?: React.Key };
                    void _tk;
                    return <span key={k} {...tokenRest} />;
                  })}
                </div>
              );
            })}
          </pre>
        )}
      </Highlight>
    </div>
  );
}

function inlineMd(s: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let idx = 0;
  const re = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(s))) {
    if (m.index > idx) nodes.push(s.slice(idx, m.index));
    if (m[1]) nodes.push(<strong key={key++}>{m[2]}</strong>);
    else if (m[3]) nodes.push(<code key={key++}>{m[4]}</code>);
    else if (m[5])
      nodes.push(
        <a
          key={key++}
          href={m[7]}
          target="_blank"
          rel="noopener noreferrer"
          className="fg-base underline underline-offset-2 hover:opacity-80"
        >
          {m[6]}
        </a>
      );
    idx = m.index + m[0].length;
  }
  if (idx < s.length) nodes.push(s.slice(idx));
  return nodes;
}

export function renderMarkdown(text: string, options: { streaming?: boolean } = {}): React.ReactNode[] {
  const { streaming = false } = options;
  if (!text) return [];

  // Split code fences first
  const blocks: Array<{ kind: 'md'; text: string } | { kind: 'code'; lang: string; body: string }> = [];
  const fenceRe = /```([a-z]*)\n([\s\S]*?)```/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(text))) {
    if (m.index > lastIdx) blocks.push({ kind: 'md', text: text.slice(lastIdx, m.index) });
    blocks.push({ kind: 'code', lang: m[1], body: m[2] });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) blocks.push({ kind: 'md', text: text.slice(lastIdx) });

  const out: React.ReactNode[] = [];
  blocks.forEach((blk, bi) => {
    if (blk.kind === 'code') {
      out.push(<CodeBlock key={'c' + bi} lang={blk.lang} body={blk.body.replace(/\n$/, '')} />);
      return;
    }
    const lines = blk.text.split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        i++;
        continue;
      }
      // Heading
      const h = /^(#{1,3})\s+(.*)$/.exec(line);
      if (h) {
        const level = h[1].length;
        const Tag = ('h' + level) as 'h1' | 'h2' | 'h3';
        out.push(<Tag key={bi + '-' + i}>{inlineMd(h[2])}</Tag>);
        i++;
        continue;
      }
      // Blockquote
      if (line.startsWith('> ')) {
        const qlines: string[] = [];
        while (i < lines.length && lines[i].startsWith('> ')) {
          qlines.push(lines[i].slice(2));
          i++;
        }
        out.push(
          <blockquote key={bi + '-' + i}>
            {qlines.map((ql, k) => (
              <React.Fragment key={k}>
                {inlineMd(ql)}
                {k < qlines.length - 1 ? <br /> : null}
              </React.Fragment>
            ))}
          </blockquote>
        );
        continue;
      }
      // Table (header | separator | rows)
      if (line.includes('|') && lines[i + 1] && /^\s*\|?\s*:?-+/.test(lines[i + 1])) {
        const header = line.split('|').map((s) => s.trim()).filter(Boolean);
        i += 2;
        const rows: string[][] = [];
        while (i < lines.length && lines[i].includes('|')) {
          rows.push(lines[i].split('|').map((s) => s.trim()).filter(Boolean));
          i++;
        }
        out.push(
          <table key={bi + '-t' + i}>
            <thead>
              <tr>
                {header.map((hh, k) => (
                  <th key={k}>{inlineMd(hh)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, k) => (
                <tr key={k}>
                  {r.map((c, kk) => (
                    <td key={kk}>{inlineMd(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        );
        continue;
      }
      // Unordered list
      if (/^\s*[-*]\s+/.test(line)) {
        const items: string[] = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
          i++;
        }
        out.push(
          <ul key={bi + '-u' + i}>
            {items.map((it, k) => (
              <li key={k}>{inlineMd(it)}</li>
            ))}
          </ul>
        );
        continue;
      }
      // Ordered list
      if (/^\s*\d+\.\s+/.test(line)) {
        const items: string[] = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
          i++;
        }
        out.push(
          <ol key={bi + '-o' + i}>
            {items.map((it, k) => (
              <li key={k}>{inlineMd(it)}</li>
            ))}
          </ol>
        );
        continue;
      }
      // Paragraph — gather until blank line
      const para = [line];
      i++;
      while (i < lines.length && lines[i].trim() && !/^(#|>|-|\*|\d+\.|\|)/.test(lines[i])) {
        para.push(lines[i]);
        i++;
      }
      out.push(<p key={bi + '-p' + i}>{inlineMd(para.join(' '))}</p>);
    }
  });

  if (streaming) {
    out.push(<span key="cursor" className="streaming-cursor" />);
  }
  return out;
}
