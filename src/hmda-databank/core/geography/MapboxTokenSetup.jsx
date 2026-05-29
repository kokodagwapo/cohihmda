import { useCallback, useState } from 'react'
import {
  clearMapboxToken,
  envMapboxLine,
  isValidMapboxToken,
  readMapboxToken,
  saveMapboxToken,
} from './mapbox-token.js'

export default function MapboxTokenSetup({ onTokenSaved }) {
  const existing = readMapboxToken()
  const [value, setValue] = useState(existing.source === 'local' ? existing.token : '')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [showToken, setShowToken] = useState(false)

  const handleSave = useCallback(() => {
    const t = value.trim()
    if (!isValidMapboxToken(t)) {
      setError('Paste a public token that starts with pk. Secret tokens (sk.) cannot be used in the browser map.')
      return
    }
    setError('')
    saveMapboxToken(t)
    onTokenSaved?.(t)
  }, [value, onTokenSaved])

  const handleClear = useCallback(() => {
    clearMapboxToken()
    setValue('')
    setError('')
    onTokenSaved?.('')
  }, [onTokenSaved])

  const copyEnvLine = useCallback(async () => {
    const t = value.trim()
    if (!isValidMapboxToken(t)) {
      setError('Enter a valid pk. token first.')
      return
    }
    setError('')
    try {
      await navigator.clipboard.writeText(envMapboxLine(t))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy — select the line below and copy manually.')
    }
  }, [value])

  return (
    <div className="hmda-geo-mapbox-setup">
      <p className="hmda-geo-mapbox-fallback__title">Connect Mapbox</p>
      <p className="hmda-geo-mapbox-fallback__body">
        Add your <strong>public</strong> access token below to load the 3D satellite map immediately, or paste the
        same value into <code>.env</code> as <code>VITE_MAPBOX_ACCESS_TOKEN</code> for a permanent setup.
      </p>

      <label className="hmda-geo-mapbox-setup__label" htmlFor="hmda-mapbox-token">
        Mapbox public token
      </label>
      <div className="hmda-geo-mapbox-setup__row">
        <input
          id="hmda-mapbox-token"
          className="hmda-geo-mapbox-setup__input"
          type={showToken ? 'text' : 'password'}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setError('')
          }}
          placeholder="pk.eyJ1Ijoi..."
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          className="hmda-geo-mapbox-setup__btn hmda-geo-mapbox-setup__btn--ghost"
          onClick={() => setShowToken((v) => !v)}
        >
          {showToken ? 'Hide' : 'Show'}
        </button>
      </div>

      {error ? <p className="hmda-geo-mapbox-setup__error">{error}</p> : null}

      <div className="hmda-geo-mapbox-setup__actions">
        <button type="button" className="hmda-geo-mapbox-setup__btn hmda-geo-mapbox-setup__btn--primary" onClick={handleSave}>
          Save &amp; load map
        </button>
        <button type="button" className="hmda-geo-mapbox-setup__btn" onClick={copyEnvLine}>
          {copied ? 'Copied!' : 'Copy .env line'}
        </button>
        <a
          className="hmda-geo-mapbox-setup__btn hmda-geo-mapbox-setup__btn--link"
          href="https://account.mapbox.com/access-tokens/"
          target="_blank"
          rel="noreferrer"
        >
          Get token at mapbox.com →
        </a>
      </div>

      {isValidMapboxToken(value) && (
        <p className="hmda-geo-mapbox-setup__env-preview">
          <span className="hmda-geo-mapbox-setup__env-label">.env</span>
          <code>{envMapboxLine(value)}</code>
        </p>
      )}

      {existing.source === 'local' && (
        <button type="button" className="hmda-geo-mapbox-setup__clear" onClick={handleClear}>
          Clear saved browser token
        </button>
      )}

      {existing.source === 'env' && (
        <p className="hmda-geo-mapbox-setup__hint">
          Token is loaded from <code>.env</code>. To change it, edit <code>VITE_MAPBOX_ACCESS_TOKEN</code> and restart{' '}
          <code>npm run dev</code>.
        </p>
      )}
    </div>
  )
}
