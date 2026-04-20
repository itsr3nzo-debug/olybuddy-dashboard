import React from 'react';

/**
 * Tiny markdown renderer — handles the subset the mock data uses:
 * headings (# ## ###), bold **, inline code `, links, lists (ul+ol), tables,
 * blockquote, code fences ``` and paragraphs.
 */

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
        <a key={key++} href={m[7]} onClick={(e) => e.preventDefault()}>
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
      out.push(
        <pre key={'c' + bi}>
          <code>{blk.body.replace(/\n$/, '')}</code>
        </pre>
      );
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
