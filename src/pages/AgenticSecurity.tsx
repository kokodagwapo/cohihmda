import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import mermaid from "mermaid";
import { Navigation } from "@/components/layout/Navigation";
import { Shield } from "lucide-react";
import agenticSecuritySource from "../../docs/security/AGENTIC_AI_DATA_SECURITY_AND_COMPLIANCE.md?raw";
import "./agentic-security.css";

let mermaidInitialized = false;

function ensureMermaidInit() {
  if (mermaidInitialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "neutral",
    securityLevel: "loose",
    fontFamily: "inherit",
  });
  mermaidInitialized = true;
}

function MermaidDiagram({ definition }: { definition: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(
    `mmd-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensureMermaidInit();
    let cancelled = false;
    const id = idRef.current;
    setError(null);
    mermaid
      .render(id, definition)
      .then(({ svg, bindFunctions }) => {
        if (cancelled || !wrapRef.current) return;
        wrapRef.current.innerHTML = svg;
        bindFunctions?.(wrapRef.current);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Diagram failed to render");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [definition]);

  if (error) {
    return (
      <div className="agentic-md-mermaid agentic-md-mermaid--error rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        {error}
      </div>
    );
  }

  return (
    <div
      className="agentic-md-mermaid rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      ref={wrapRef}
      aria-busy={!wrapRef.current?.innerHTML}
    />
  );
}

export default function AgenticSecurity() {
  useEffect(() => {
    ensureMermaidInit();
  }, []);

  return (
    <div className="agentic-security-page min-h-screen bg-white text-slate-800">
      <Navigation />
      <main className="agentic-security-main mx-auto max-w-4xl px-4 pb-20 pt-6 sm:px-6 lg:px-8">
        <header className="mb-10 flex flex-col gap-3 border-b border-slate-200 pb-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-teal-50 text-teal-700 ring-1 ring-teal-100">
              <Shield className="h-6 w-6" aria-hidden />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-teal-700">
                Security &amp; compliance
              </p>
              <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                Agentic AI data security
              </h1>
              <p className="mt-1 max-w-xl text-sm text-slate-600">
                Living reference: architecture, trust boundaries, SOC 2 framing, and vendor trust
                links. Sourced from the repository markdown.
              </p>
            </div>
          </div>
        </header>

        <article className="agentic-security-prose">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw]}
            components={{
              h1: ({ children }) => (
                <h1 className="mt-10 scroll-mt-24 border-b border-slate-200 pb-3 text-2xl font-bold text-slate-900 first:mt-0">
                  {children}
                </h1>
              ),
              h2: ({ children }) => (
                <h2 className="mt-10 scroll-mt-24 text-xl font-semibold text-slate-900">
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 className="mt-8 text-lg font-semibold text-slate-800">{children}</h3>
              ),
              p: ({ children }) => (
                <p className="my-4 leading-relaxed text-slate-700">{children}</p>
              ),
              a: ({ href, children }) => (
                <a
                  href={href}
                  className="font-medium text-teal-700 underline decoration-teal-200 underline-offset-2 hover:text-teal-800"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {children}
                </a>
              ),
              ul: ({ children }) => (
                <ul className="my-4 list-disc space-y-2 pl-6 text-slate-700">{children}</ul>
              ),
              ol: ({ children }) => (
                <ol className="my-4 list-decimal space-y-2 pl-6 text-slate-700">{children}</ol>
              ),
              li: ({ children }) => <li className="leading-relaxed">{children}</li>,
              blockquote: ({ children }) => (
                <blockquote className="my-6 border-l-4 border-teal-500 bg-teal-50/60 py-3 pl-4 pr-4 text-slate-700">
                  {children}
                </blockquote>
              ),
              table: ({ children }) => (
                <div className="my-6 overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
                  <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
                    {children}
                  </table>
                </div>
              ),
              thead: ({ children }) => (
                <thead className="bg-slate-50 text-slate-900">{children}</thead>
              ),
              th: ({ children }) => (
                <th className="border-b border-slate-200 px-3 py-2 font-semibold">{children}</th>
              ),
              td: ({ children }) => (
                <td className="border-b border-slate-100 px-3 py-2 align-top text-slate-700">
                  {children}
                </td>
              ),
              tr: ({ children }) => <tr className="hover:bg-slate-50/80">{children}</tr>,
              hr: () => <hr className="my-10 border-slate-200" />,
              pre: ({ children }) => <>{children}</>,
              code: ({ className, children }) => {
                const match = /language-(\w+)/.exec(className || "");
                const lang = match?.[1];
                const raw = String(children).replace(/\n$/, "");
                if (lang === "mermaid") {
                  return <MermaidDiagram definition={raw} />;
                }
                if (lang === "text" || lang === "ascii") {
                  return (
                    <pre className="my-6 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-800">
                      {raw}
                    </pre>
                  );
                }
                if (className) {
                  return (
                    <pre className="my-6 overflow-x-auto rounded-lg border border-slate-200 bg-slate-900 p-4 font-mono text-xs text-slate-100">
                      <code>{raw}</code>
                    </pre>
                  );
                }
                return (
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.9em] text-slate-800">
                    {children}
                  </code>
                );
              },
              figure: ({ children }) => (
                <figure className="my-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  {children}
                </figure>
              ),
              figcaption: ({ children }) => (
                <figcaption className="border-t border-slate-100 bg-slate-50/80 px-4 py-3 text-sm text-slate-600">
                  {children}
                </figcaption>
              ),
              strong: ({ children }) => (
                <strong className="font-semibold text-slate-900">{children}</strong>
              ),
              em: ({ children }) => <em className="italic text-slate-700">{children}</em>,
            }}
          >
            {agenticSecuritySource}
          </ReactMarkdown>
        </article>
      </main>
    </div>
  );
}
