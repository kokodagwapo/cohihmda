import React, { useCallback, useEffect, useRef, useState } from 'react'
import { FileSpreadsheet, Plus, Search, Sparkles } from 'lucide-react'
import { detectUploadKind } from './hmda-cohi-client.js'
import { useHmdaCohiAnalyst } from './useHmdaCohiAnalyst.js'
import './hmda-hero-search-combo.css'

const CSV_ACCEPT = '.csv,text/csv'
const EXCEL_ACCEPT =
  '.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel'

function HmdaHeroUploadAdd({ onPick }) {
  const [open, setOpen] = useState(false)
  const closeTimer = useRef(null)
  const csvRef = useRef(null)
  const excelRef = useRef(null)

  const clearCloseTimer = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  const showMenu = () => {
    clearCloseTimer()
    setOpen(true)
  }

  const hideMenuSoon = () => {
    clearCloseTimer()
    closeTimer.current = setTimeout(() => setOpen(false), 140)
  }

  useEffect(() => () => clearCloseTimer(), [])

  const onFileChange = (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    setOpen(false)
    onPick(f)
  }

  const pickCsv = () => {
    clearCloseTimer()
    setOpen(false)
    csvRef.current?.click()
  }

  const pickExcel = () => {
    clearCloseTimer()
    setOpen(false)
    excelRef.current?.click()
  }

  return (
    <div
      className={`hmda-hero-upload-add${open ? ' is-open' : ''}`}
      onMouseEnter={showMenu}
      onMouseLeave={hideMenuSoon}
    >
      <input ref={csvRef} type="file" accept={CSV_ACCEPT} className="hmda-hero-upload-add__input" onChange={onFileChange} />
      <input
        ref={excelRef}
        type="file"
        accept={EXCEL_ACCEPT}
        className="hmda-hero-upload-add__input"
        onChange={onFileChange}
      />
      <button
        type="button"
        className="hmda-hero-combo-add-btn hmda-ds-hero-search-icon-well"
        title="Upload CSV or Excel to compare with HMDA"
        aria-label="Upload CSV or Excel"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Plus size={18} strokeWidth={2} aria-hidden />
      </button>
      {open ? (
        <div
          className="hmda-hero-upload-add-menu"
          role="menu"
          onMouseEnter={showMenu}
          onMouseLeave={hideMenuSoon}
        >
          <button type="button" role="menuitem" className="hmda-hero-upload-add-menu__item" onClick={pickCsv}>
            <span className="hmda-hero-upload-add-menu__label">CSV</span>
            <span className="hmda-hero-upload-add-menu__hint">.csv</span>
          </button>
          <button type="button" role="menuitem" className="hmda-hero-upload-add-menu__item" onClick={pickExcel}>
            <span className="hmda-hero-upload-add-menu__label">Excel</span>
            <span className="hmda-hero-upload-add-menu__hint">.xlsx, .xls</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Hero landing: unified HMDA search + CSV/Excel analyst (no mode switch).
 */
export default function HmdaHeroSearchCombo({
  isMobile,
  dk,
  c,
  IC,
  cohiUploadTheme,
  qInput,
  setQInput,
  showSuggestions,
  setShowSuggestions,
  searchSuggestions,
  commitSearch,
  clearSearch,
  heroSearchRef,
  hmdaSearchLenderMapBtn,
  suggestionToQueryValue,
}) {
  const [followUp, setFollowUp] = useState('')
  const analyst = useHmdaCohiAnalyst(cohiUploadTheme)

  const onFilePicked = useCallback(
    (file) => {
      if (!file) return
      const kind = detectUploadKind(file)
      if (!kind) {
        analyst.stageFile(file)
        return
      }
      analyst.runAnalyze(kind, file)
    },
    [analyst],
  )

  const onFollowUpSubmit = async () => {
    const t = followUp.trim()
    if (!t || analyst.busy) return
    const ok = await analyst.sendChat(t)
    if (ok) setFollowUp('')
  }

  const hasInsights = analyst.messages.length > 0 || analyst.busy
  const canFollowUp = Boolean(analyst.digest) && !analyst.busy

  return (
    <div className="hmda-ds-hero-search-field-wrap hmda-hero-combo">
      <div className="hmda-hero-search-row hmda-ds-hero-search-row hmda-hero-combo-row">
        <HmdaHeroUploadAdd onPick={onFilePicked} />
        {analyst.stagedFile ? (
          <span className="hmda-hero-combo-file-chip">
            <FileSpreadsheet size={12} strokeWidth={2} aria-hidden />
            <span className="hmda-hero-combo-file-chip__name">{analyst.stagedFile.file.name}</span>
            <button type="button" className="hmda-hero-combo-file-chip__clear" aria-label="Remove file" onClick={analyst.clearStaged}>
              ×
            </button>
          </span>
        ) : null}
        <div className="hmda-hero-combo-input-wrap">
          <Search size={17} strokeWidth={2} className="hmda-hero-combo-input-icon" aria-hidden />
          <input
            ref={heroSearchRef}
            type="text"
            className="hmda-hero-combo-input"
            placeholder="Search lenders & geography, or upload CSV / Excel…"
            value={qInput}
            onChange={(e) => {
              setQInput(e.target.value)
              setShowSuggestions(true)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitSearch(qInput)
              }
            }}
            onFocus={() => {
              const t = qInput.trim()
              if (/^\d+$/.test(t) || t.length >= 2) setShowSuggestions(true)
            }}
          />
        </div>
        {qInput ? (
          <button
            type="button"
            onClick={clearSearch}
            aria-label="Clear search"
            className="hmda-ds-hero-search-clear"
            style={{
              border: 'none',
              background: dk ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.06)',
              borderRadius: '10px',
              width: '34px',
              height: '34px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: c.text3,
              flexShrink: 0,
            }}
          >
            {IC.x}
          </button>
        ) : null}
        {hmdaSearchLenderMapBtn}
        <button
          type="button"
          className={`hmda-ds-hero-search-submit${isMobile ? ' hmda-ds-hero-search-submit--icon-only' : ''}`}
          onClick={() => commitSearch(qInput)}
          aria-label="Search HMDA"
        >
          {isMobile ? (
            <span style={{ display: 'inline-flex', color: 'inherit' }} aria-hidden>
              {IC.chevRight}
            </span>
          ) : (
            <>
              Search{' '}
              <span style={{ display: 'inline-flex', opacity: 0.88, marginLeft: 2 }} aria-hidden>
                {IC.chevRight}
              </span>
            </>
          )}
        </button>
      </div>

      {showSuggestions && searchSuggestions.length > 0 ? (
        <div
          data-hmda-search-ui
          className="hmda-hero-combo-suggestions"
          style={{
            background: c.surface,
            border: `1px solid ${c.border}`,
            boxShadow: dk ? '0 12px 32px rgba(0,0,0,0.35)' : '0 12px 28px rgba(15,23,42,0.1)',
          }}
        >
          {searchSuggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => commitSearch(suggestionToQueryValue(s))}
              className="hmda-hero-combo-suggestion"
              style={{ color: c.text2 }}
            >
              <span className="hmda-hero-combo-suggestion__label">{s.label}</span>
              <span className="hmda-hero-combo-suggestion__cat" style={{ color: c.text4, background: c.chip }}>
                {s.category}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {hasInsights ? (
        <div className="hmda-hero-combo-insights" style={{ color: c.text2 }}>
          <div className="hmda-hero-combo-insights__head" style={{ color: c.text4 }}>
            <span>
              <Sparkles size={12} style={{ verticalAlign: -2, marginRight: 4 }} aria-hidden />
              HMDA analyst
              {analyst.filename ? ` · ${analyst.filename}` : ''}
            </span>
            <button
              type="button"
              className="hmda-hero-combo-insights__clear"
              onClick={() => {
                analyst.resetAnalyst()
                setFollowUp('')
              }}
              style={{ color: c.accent }}
            >
              Clear
            </button>
          </div>
          {analyst.messages.map((m, i) => (
            <div
              key={i}
              className={`hmda-hero-combo-bubble hmda-hero-combo-bubble--${m.role === 'user' ? 'user' : 'ai'}`}
            >
              {m.content}
            </div>
          ))}
          {analyst.busy ? (
            <div className="hmda-hero-combo-bubble hmda-hero-combo-bubble--ai" style={{ color: c.text4 }}>
              Crunching your file against HMDA lenses…
            </div>
          ) : null}
          {analyst.error ? (
            <p className="hmda-hero-combo-insights__error">{analyst.error}</p>
          ) : null}
          {canFollowUp ? (
            <div className="hmda-hero-combo-followup">
              <input
                type="text"
                className="hmda-hero-combo-followup__input"
                placeholder="Follow-up on your file…"
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    onFollowUpSubmit()
                  }
                }}
              />
              <button type="button" className="hmda-hero-combo-followup__send" onClick={onFollowUpSubmit} disabled={!followUp.trim()}>
                Ask
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
