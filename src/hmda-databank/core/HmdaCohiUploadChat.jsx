import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ShoppingCart, Upload } from 'lucide-react'
import './hmda-cohi-chat.css'

function stripSpeechMarkdown(text) {
  return String(text || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*]\s+/gm, '')
}

/** Align with server/hmda-cohi-upload-security.mjs defaults */
const MAX_CSV_BYTES = 2 * 1024 * 1024
const MAX_XLSX_BYTES = 3 * 1024 * 1024

async function assertExcelMagicSlice(file) {
  const n = Math.min(file.size, 8)
  if (n < 4) throw new Error('File is too small to be Excel.')
  const u8 = new Uint8Array(await file.slice(0, n).arrayBuffer())
  const zip = u8[0] === 0x50 && u8[1] === 0x4b
  const ole = u8[0] === 0xd0 && u8[1] === 0xcf && u8[2] === 0x11 && u8[3] === 0xe0
  const mz = u8[0] === 0x4d && u8[1] === 0x5a
  const elf = u8[0] === 0x7f && u8[1] === 0x45 && u8[2] === 0x4c && u8[3] === 0x46
  if (mz || elf) throw new Error('Executable files are not allowed. Use CSV or Excel only.')
  if (!zip && !ole) throw new Error('Not a valid Excel file (.xlsx or .xls).')
}

async function assertCsvTextSlice(file) {
  const n = Math.min(file.size, 8192)
  if (n === 0) throw new Error('Empty file.')
  const u8 = new Uint8Array(await file.slice(0, n).arrayBuffer())
  let nulls = 0
  for (let i = 0; i < u8.length; i++) {
    const b = u8[i]
    if (b === 0) nulls++
    else if (b < 32 && b !== 9 && b !== 10 && b !== 13) {
      throw new Error('CSV must be plain text (tab/newline allowed). Binary content rejected.')
    }
  }
  if (u8.length && nulls / u8.length > 0.002) throw new Error('CSV appears binary — use UTF-8 text export.')
}

async function validateUploadFile(kind, file) {
  const lower = String(file.name || '').toLowerCase()
  if (kind === 'csv') {
    if (!lower.endsWith('.csv')) throw new Error('Choose a .csv file.')
    if (file.size > MAX_CSV_BYTES) throw new Error(`CSV must be under ${MAX_CSV_BYTES / (1024 * 1024)} MB.`)
    await assertCsvTextSlice(file)
    return
  }
  if (!/\.(xlsx|xls)$/i.test(lower)) throw new Error('Choose .xlsx or .xls.')
  if (/\.(xlsm|xlsb)$/i.test(lower)) throw new Error('Macro-enabled Excel (.xlsm/.xlsb) is not accepted.')
  if (file.size > MAX_XLSX_BYTES) throw new Error(`Excel must be under ${MAX_XLSX_BYTES / (1024 * 1024)} MB.`)
  await assertExcelMagicSlice(file)
}

async function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => reject(r.error)
    r.readAsText(file)
  })
}

async function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const dataUrl = String(r.result || '')
      const idx = dataUrl.indexOf('base64,')
      resolve(idx === -1 ? '' : dataUrl.slice(idx + 7))
    }
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

function downloadText(filename, mime, text) {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * Hero-row upload (+) and slide-over analyst chat: OpenAI analysis + Gemini export (server keys).
 */
export default function HmdaCohiUploadChat({ theme, minimalTrigger = false }) {
  const { dk, surface, border, text, textMuted, accent, chip } = theme || {}
  const csvRef = useRef(null)
  const xlsxRef = useRef(null)
  const popRef = useRef(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [digest, setDigest] = useState(null)
  const [filename, setFilename] = useState('')
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [listening, setListening] = useState(false)
  const recRef = useRef(null)

  useEffect(() => {
    const onDoc = (e) => {
      if (!menuOpen) return
      const el = popRef.current
      if (el && !el.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

  const appendAssistant = useCallback((content) => {
    setMessages((prev) => [...prev, { role: 'assistant', content }])
  }, [])

  const runAnalyze = useCallback(
    async (kind, file) => {
      setBusy(true)
      setError('')
      setDrawerOpen(true)
      setDigest(null)
      setFilename(file.name)
      setMessages([{ role: 'user', content: `Uploaded ${kind.toUpperCase()}: ${file.name}` }])

      try {
        await validateUploadFile(kind, file)

        let payload
        if (kind === 'csv') {
          payload = await readFileAsText(file)
        } else {
          payload = await readFileAsBase64(file)
        }

        const res = await fetch('/api/hmda/cohi/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind,
            filename: file.name,
            payload,
            hmdaContext: theme?.hmdaContext || {},
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || `Analyze failed (${res.status})`)

        setDigest(data.digest ?? null)
        appendAssistant(data.reply || '')
      } catch (e) {
        setError(e?.message || 'Upload failed')
        appendAssistant(`Could not complete analysis: ${e?.message || 'Unknown error'}`)
      } finally {
        setBusy(false)
      }
    },
    [appendAssistant, theme],
  )

  const sendChat = useCallback(async () => {
    const t = draft.trim()
    if (!t || busy) return

    const nextHistory = [...messages, { role: 'user', content: t }]
    setMessages(nextHistory)
    setDraft('')
    setBusy(true)
    setError('')

    try {
      const res = await fetch('/api/hmda/cohi/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextHistory,
          digest,
          hmdaContext: theme?.hmdaContext || {},
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Chat failed (${res.status})`)
      appendAssistant(data.reply || '')
    } catch (e) {
      setError(e?.message || 'Chat failed')
      appendAssistant(`Chat error: ${e?.message || 'Unknown error'}`)
    } finally {
      setBusy(false)
    }
  }, [appendAssistant, busy, digest, draft, messages, theme])

  const exportReport = useCallback(
    async (format) => {
      setBusy(true)
      setError('')
      try {
        const res = await fetch('/api/hmda/cohi/export', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            format,
            messages,
            digest,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || `Export failed (${res.status})`)
        const body = data.body || ''
        if (format === 'html') {
          downloadText('cohi-hmda-analysis-report.html', 'text/html;charset=utf-8', body)
        } else {
          downloadText('cohi-hmda-slides-outline.md', 'text/markdown;charset=utf-8', body)
        }
      } catch (e) {
        setError(e?.message || 'Export failed')
      } finally {
        setBusy(false)
      }
    },
    [digest, messages],
  )

  const speakLast = useCallback(() => {
    const last = [...messages].reverse().find((m) => m.role === 'assistant')
    if (!last?.content || typeof window === 'undefined' || !window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(stripSpeechMarkdown(last.content))
    u.rate = 1
    window.speechSynthesis.speak(u)
  }, [messages])

  const toggleListen = useCallback(() => {
    const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)
    if (!SR) {
      setError('Voice input is not supported in this browser.')
      return
    }
    if (listening && recRef.current) {
      try {
        recRef.current.stop()
      } catch {
        /* ignore */
      }
      recRef.current = null
      setListening(false)
      return
    }

    const rec = new SR()
    rec.lang = 'en-US'
    rec.interimResults = false
    rec.maxAlternatives = 1
    rec.onresult = (ev) => {
      const text = ev.results?.[0]?.[0]?.transcript?.trim()
      if (text) setDraft((d) => (d ? `${d} ${text}` : text))
    }
    rec.onerror = () => setListening(false)
    rec.onend = () => setListening(false)
    recRef.current = rec
    setListening(true)
    try {
      rec.start()
    } catch {
      setListening(false)
      setError('Microphone could not start.')
    }
  }, [listening])

  const msgBgUser = dk ? 'rgba(99,102,241,0.28)' : 'rgba(99,102,241,0.14)'
  const msgBgAi = dk ? 'rgba(255,255,255,0.06)' : '#f8fafc'

  return (
    <>
      <div className="hmda-cohi-chat-root" ref={popRef}>
        <button
          type="button"
          className={`hmda-cohi-chat-trigger toggle-theme${minimalTrigger ? ' hmda-cohi-chat-trigger--minimal' : ''}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="Upload CSV or Excel — files are type-checked and size-limited (no macros or executables)"
          aria-label="Upload spreadsheet for Cohi analyst — CSV or Excel only, security validated"
          onClick={() => setMenuOpen((o) => !o)}
          style={minimalTrigger ? { color: accent || text } : {
            background: dk ? 'rgba(255,255,255,0.06)' : chip || 'rgba(15,23,42,0.06)',
            color: accent || text,
          }}
        >
          {minimalTrigger ? <Upload size={18} strokeWidth={1.85} aria-hidden /> : '+'}
        </button>
        <input
          ref={csvRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) runAnalyze('csv', f)
            setMenuOpen(false)
          }}
        />
        <input
          ref={xlsxRef}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) runAnalyze('xlsx', f)
            setMenuOpen(false)
          }}
        />

        {menuOpen ? (
          <div
            className="hmda-cohi-chat-popover"
            role="menu"
            style={{
              background: surface,
              border: `1px solid ${border}`,
            }}
          >
            <Link
              to="/onboarding/profile"
              className={`hmda-cohi-chat-premium-banner${dk ? ' hmda-cohi-chat-premium-banner--dark' : ''}`}
              role="note"
              aria-label="Premium Feature — Go Premium onboarding"
              onClick={() => setMenuOpen(false)}
            >
              <span className="hmda-cohi-chat-premium-banner__title">Premium Feature</span>
              <span className="hmda-cohi-chat-premium-banner__cart" aria-hidden title="Go Premium">
                <ShoppingCart size={18} strokeWidth={2} />
              </span>
            </Link>
            <button
              type="button"
              role="menuitem"
              style={{ background: 'transparent', color: text }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = dk ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.05)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
              onClick={() => csvRef.current?.click()}
            >
              <span aria-hidden style={{ opacity: 0.75 }}>
                📄
              </span>
              CSV spreadsheet
            </button>
            <button
              type="button"
              role="menuitem"
              style={{ background: 'transparent', color: text }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = dk ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.05)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
              onClick={() => xlsxRef.current?.click()}
            >
              <span aria-hidden style={{ opacity: 0.75 }}>
                📊
              </span>
              Excel (.xlsx)
            </button>
          </div>
        ) : null}
      </div>

      {drawerOpen ? (
        <>
          <div className="hmda-cohi-chat-drawer-overlay" role="presentation" onClick={() => setDrawerOpen(false)} />
          <aside
            className="hmda-cohi-chat-drawer"
            style={{
              background: surface,
              color: text,
              borderLeft: `1px solid ${border}`,
            }}
          >
            <div className="hmda-cohi-chat-drawer-head">
              <div>
                <h3>Cohi analyst</h3>
                <p style={{ color: textMuted }}>
                  Upload CSV or Excel only; files are validated for size, text/binary signatures, and macro content (server-side). This is not a full antivirus scan — never upload secrets or PII you do not trust.
                </p>
                {filename ? (
                  <p style={{ color: textMuted, fontWeight: 600 }}>{filename}</p>
                ) : null}
              </div>
              <button
                type="button"
                aria-label="Close analyst panel"
                onClick={() => setDrawerOpen(false)}
                style={{
                  border: 'none',
                  background: dk ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.06)',
                  borderRadius: '10px',
                  width: '36px',
                  height: '36px',
                  cursor: 'pointer',
                  color: text,
                  flexShrink: 0,
                  fontSize: '18px',
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>

            <div className="hmda-cohi-chat-msg-area">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`hmda-cohi-chat-bubble ${m.role === 'user' ? 'user' : 'ai'}`}
                  style={{
                    background: m.role === 'user' ? msgBgUser : msgBgAi,
                    color: text,
                    border:
                      m.role === 'user'
                        ? `1px solid ${dk ? 'rgba(165,180,252,0.35)' : 'rgba(99,102,241,0.25)'}`
                        : `1px solid ${border}`,
                  }}
                >
                  {m.content}
                </div>
              ))}
              {busy ? (
                <div className="hmda-cohi-chat-bubble ai" style={{ background: msgBgAi, color: textMuted, border: `1px solid ${border}` }}>
                  Working…
                </div>
              ) : null}
              {error ? (
                <div style={{ fontSize: 12, color: '#b45309', fontWeight: 600 }}>{error}</div>
              ) : null}
            </div>

            <div className="hmda-cohi-chat-compose">
              <div className="hmda-cohi-chat-toolbar">
                <button
                  type="button"
                  style={{ background: dk ? 'rgba(96,165,250,0.2)' : 'rgba(59,130,246,0.15)', color: text }}
                  onClick={() => exportReport('html')}
                  disabled={busy || !messages.length}
                  title="Gemini → HTML (print to PDF)"
                >
                  Export PDF-ready HTML
                </button>
                <button
                  type="button"
                  style={{ background: dk ? 'rgba(52,211,153,0.18)' : 'rgba(16,185,129,0.14)', color: text }}
                  onClick={() => exportReport('slides')}
                  disabled={busy || !messages.length}
                  title="Gemini → Markdown slide outline"
                >
                  Slide outline (.md)
                </button>
                <button
                  type="button"
                  style={{ background: dk ? 'rgba(244,114,182,0.15)' : 'rgba(236,72,153,0.12)', color: text }}
                  onClick={speakLast}
                  disabled={!messages.some((m) => m.role === 'assistant')}
                >
                  Read aloud
                </button>
                <button
                  type="button"
                  style={{
                    background: listening ? 'rgba(239,68,68,0.25)' : dk ? 'rgba(255,255,255,0.09)' : 'rgba(15,23,42,0.06)',
                    color: text,
                  }}
                  onClick={toggleListen}
                >
                  {listening ? 'Stop mic' : 'Voice'}
                </button>
              </div>

              <div className="hmda-cohi-chat-compose-row">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      sendChat()
                    }
                  }}
                  placeholder="Ask Cohi a follow-up…"
                  style={{
                    background: dk ? 'rgba(255,255,255,0.05)' : '#fff',
                    color: text,
                    borderColor: border,
                  }}
                  disabled={busy}
                  rows={2}
                />
                <button
                  type="button"
                  onClick={sendChat}
                  disabled={busy || !draft.trim()}
                  style={{
                    padding: '10px 14px',
                    borderRadius: '12px',
                    border: 'none',
                    fontWeight: 700,
                    cursor: busy ? 'wait' : 'pointer',
                    background: accent || '#6366f1',
                    color: '#fff',
                    fontFamily: 'inherit',
                    flexShrink: 0,
                  }}
                >
                  Send
                </button>
              </div>
            </div>
          </aside>
        </>
      ) : null}
    </>
  )
}
