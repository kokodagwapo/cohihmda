import '@/hmda/saas/hmda-saas-pages.css'
import SprinkleAmbientBackdrop from '@/components/sprinkle/SprinkleAmbientBackdrop.jsx'
import React, { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'

/** Centered premium shell for HMDA SaaS pages (outside main site header). */
export default function HmdaSaaSShell({ title, subtitle, children, wide, fullWidth, noPad = false, auth = false, signup = false, onSignOut = null }) {
  const navigate = useNavigate()

  useEffect(() => {
    document.body.classList.add('sx-body-transparent', 'hmda-saas-sprinkle-active')
    return () => document.body.classList.remove('sx-body-transparent', 'hmda-saas-sprinkle-active')
  }, [])

  const goHmdaHome = (e) => {
    if (e.defaultPrevented) return
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
    if (e.button !== 0) return
    e.preventDefault()
    navigate('/')
  }

  const goBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      navigate(-1)
      return
    }
    navigate('/')
  }

  return (
    <div
      className={`hmda-saas-page hmda-saas-page--sprinkle ${wide ? 'hmda-saas-wide' : ''} ${fullWidth ? 'hmda-saas-page--fullwidth' : ''} ${auth ? 'hmda-saas-page--auth' : ''} ${signup ? 'hmda-saas-page--signup' : ''}`}
    >
      <SprinkleAmbientBackdrop decorations={false} />
      <div className="relative z-10 isolate min-h-screen">
        <div className="hmda-saas-inner">
          <header className={`hmda-saas-topbar${auth ? ' hmda-saas-topbar--auth' : ''}`}>
            {!onSignOut && (
              <a
                href="/"
                className="hmda-saas-brand"
                onClick={goHmdaHome}
                aria-label="HMDA — Public HMDA DataBank home"
              >
                <img src="/coheus-logo.png" alt="" className="hmda-saas-brand-logo" />
                <span className="hmda-saas-brand-text">
                  <span className="hmda-saas-brand-title hmda-saas-brand-accent">HMDA</span>
                  {!auth ? <span className="hmda-saas-brand-tagline">Public HMDA DataBank</span> : null}
                </span>
              </a>
            )}
            <div className="hmda-saas-topbar-links">
              {auth ? (
                <>
                  <a href="/" className="hmda-saas-nav-link" onClick={goHmdaHome}>
                    DataBank
                  </a>
                  <Link to="/signup" className="hmda-saas-nav-link hmda-saas-nav-link--accent">
                    Sign up
                  </Link>
                </>
              ) : (
                <>
                  <button type="button" className="hmda-saas-pill hmda-saas-pill--ghost" onClick={goBack}>
                    ← Back
                  </button>
                  <Link to="/signin" className="hmda-saas-pill hmda-saas-pill--ghost">
                    Sign In
                  </Link>
                  <Link to="/signup" className="hmda-saas-pill hmda-saas-pill--primary">
                    Sign Up
                  </Link>
                </>
              )}
            </div>
          </header>

          <main className={`hmda-saas-main${noPad ? ' hmda-saas-main--nopad' : ''}`}>
            {!auth && (title || subtitle) ? (
              <div className={`hmda-saas-hero-text${signup ? ' hmda-saas-hero-text--signup' : ''}`}>
                {title ? <h1 className="hmda-saas-title">{title}</h1> : null}
                {subtitle ? <p className="hmda-saas-subtitle">{subtitle}</p> : null}
              </div>
            ) : null}
            {noPad ? (
              children
            ) : fullWidth ? (
              <div className="hmda-saas-fullwidth-main">{children}</div>
            ) : (
              <div className={`hmda-saas-card${auth ? ' hmda-saas-card--auth' : ''}${signup ? ' hmda-saas-card--signup' : ''}`}>{children}</div>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}
