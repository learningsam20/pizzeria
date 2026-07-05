import React, { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BookOpen, RefreshCw, AlertTriangle, Search, ChevronRight, List } from 'lucide-react';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

function extractHeadings(markdown: string): { level: number; text: string; id: string }[] {
  const headings: { level: number; text: string; id: string }[] = [];
  for (const line of markdown.split('\n')) {
    const match = line.match(/^(#{2,3})\s+(.+)$/);
    if (!match) continue;
    const text = match[2].replace(/\*\*/g, '').trim();
    headings.push({ level: match[1].length, text, id: slugify(text) });
  }
  return headings;
}

function filterMarkdownBySearch(markdown: string, query: string): string {
  const q = query.trim().toLowerCase();
  if (!q) return markdown;

  const sections = markdown.split(/\n(?=## )/);
  const kept = sections.filter((section, idx) => {
    if (idx === 0 && !section.startsWith('## ')) {
      return section.toLowerCase().includes(q);
    }
    return section.toLowerCase().includes(q);
  });

  return kept.length > 0 ? kept.join('\n') : '_No sections match your search._';
}

export default function AppHelp() {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeId, setActiveId] = useState<string>('');

  const loadHelp = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/app-help');
      if (!res.ok) throw new Error('Could not load help content.');
      const data = await res.json();
      setContent(data.content || '');
    } catch (e: any) {
      setError(e.message || 'Failed to load help.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHelp();
  }, []);

  const headings = useMemo(() => extractHeadings(content), [content]);
  const displayContent = useMemo(
    () => filterMarkdownBySearch(content, search),
    [content, search]
  );

  const scrollTo = (id: string) => {
    setActiveId(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const mdComponents = {
    h2: ({ children }: { children?: React.ReactNode }) => {
      const text = String(children);
      const id = slugify(text);
      return (
        <h2
          id={id}
          className="scroll-mt-24 text-noir-gold font-serif text-xl mt-10 mb-3 pb-2 border-b border-noir-border first:mt-0"
        >
          {children}
        </h2>
      );
    },
    h3: ({ children }: { children?: React.ReactNode }) => {
      const id = slugify(String(children));
      return (
        <h3 id={id} className="scroll-mt-24 text-noir-text font-semibold text-base mt-6 mb-2">
          {children}
        </h3>
      );
    },
    table: ({ children }: { children?: React.ReactNode }) => (
      <div className="overflow-x-auto my-4 rounded-xl border border-noir-border">
        <table className="min-w-full text-xs">{children}</table>
      </div>
    ),
    thead: ({ children }: { children?: React.ReactNode }) => (
      <thead className="bg-noir-highlight text-noir-dim uppercase tracking-wider text-[10px]">{children}</thead>
    ),
    tbody: ({ children }: { children?: React.ReactNode }) => (
      <tbody className="divide-y divide-noir-border">{children}</tbody>
    ),
    tr: ({ children }: { children?: React.ReactNode }) => (
      <tr className="hover:bg-noir-panel/50">{children}</tr>
    ),
    th: ({ children }: { children?: React.ReactNode }) => (
      <th className="px-3 py-2 text-left font-semibold">{children}</th>
    ),
    td: ({ children }: { children?: React.ReactNode }) => (
      <td className="px-3 py-2 text-noir-muted">{children}</td>
    ),
    blockquote: ({ children }: { children?: React.ReactNode }) => (
      <blockquote className="my-4 pl-4 border-l-2 border-noir-gold/50 bg-noir-highlight/30 py-2 pr-3 rounded-r-lg text-noir-muted text-sm">
        {children}
      </blockquote>
    ),
    code: ({ inline, children }: { inline?: boolean; children?: React.ReactNode }) =>
      inline ? (
        <code className="text-amber-200 bg-noir-panel px-1.5 py-0.5 rounded text-[11px] font-mono">{children}</code>
      ) : (
        <code className="block text-amber-200 bg-noir-panel p-3 rounded-xl text-[11px] font-mono overflow-x-auto my-3">
          {children}
        </code>
      ),
    pre: ({ children }: { children?: React.ReactNode }) => <pre className="my-0">{children}</pre>,
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
      <a href={href} className="text-noir-gold hover:underline">{children}</a>
    ),
    ul: ({ children }: { children?: React.ReactNode }) => (
      <ul className="list-disc pl-5 space-y-1 my-3 text-noir-muted">{children}</ul>
    ),
    ol: ({ children }: { children?: React.ReactNode }) => (
      <ol className="list-decimal pl-5 space-y-1 my-3 text-noir-muted">{children}</ol>
    ),
    p: ({ children }: { children?: React.ReactNode }) => (
      <p className="my-2 text-noir-muted leading-relaxed text-sm">{children}</p>
    ),
    hr: () => <hr className="my-8 border-noir-border" />,
  };

  return (
    <div className="bg-noir-card rounded-2xl border border-noir-border shadow-lg overflow-hidden" id="app-help">
      <div className="border-b border-noir-border px-6 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h3 className="font-serif italic text-noir-gold text-lg flex items-center gap-2">
            <BookOpen className="w-5 h-5" /> App Help &amp; Guide
          </h3>
          <p className="text-xs text-noir-muted mt-1 max-w-xl">
            How to use the app as customer, staff, or admin. The support chatbot reads the same guide.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full lg:w-auto">
          <div className="relative flex-1 sm:min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-noir-dim" />
            <input
              type="search"
              placeholder="Search help…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-noir-panel border border-noir-border rounded-xl text-sm text-noir-text placeholder:text-noir-dim focus:border-noir-gold outline-none"
            />
          </div>
          <button
            type="button"
            onClick={loadHelp}
            className="px-3 py-2 bg-noir-highlight border border-noir-border hover:bg-noir-sidebar rounded-xl text-xs font-semibold text-noir-text cursor-pointer inline-flex items-center justify-center gap-1.5 shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row min-h-[420px] max-h-[75vh]">
        {!loading && !error && headings.length > 0 && (
          <nav className="lg:w-56 shrink-0 border-b lg:border-b-0 lg:border-r border-noir-border bg-noir-sidebar/40 p-4 overflow-y-auto">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-noir-dim mb-2 flex items-center gap-1">
              <List className="w-3.5 h-3.5" /> On this page
            </p>
            <ul className="space-y-0.5">
              {headings.map(h => (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => scrollTo(h.id)}
                    className={`w-full text-left text-xs py-1.5 px-2 rounded-lg flex items-center gap-1 transition-colors cursor-pointer ${
                      h.level === 3 ? 'pl-4 text-noir-dim' : 'text-noir-muted'
                    } ${activeId === h.id ? 'bg-noir-highlight text-noir-gold' : 'hover:bg-noir-highlight/60 hover:text-noir-text'}`}
                  >
                    <ChevronRight className="w-3 h-3 shrink-0 opacity-50" />
                    <span className="truncate">{h.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <div className="flex-1 p-6 overflow-y-auto">
          {loading && (
            <p className="text-sm text-noir-muted flex items-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-noir-gold" /> Loading help…
            </p>
          )}
          {error && (
            <div className="rounded-xl border border-amber-900/40 bg-amber-950/30 p-4 text-sm text-amber-200 flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {!loading && !error && displayContent && (
            <article className="max-w-3xl">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                {displayContent}
              </ReactMarkdown>
            </article>
          )}
        </div>
      </div>
    </div>
  );
}
