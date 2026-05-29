import React, { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useHmdaAuth } from '@hmda/context/HmdaAuthBridge'

function IconShoppingCart() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  )
}

function IconLogIn() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <path d="m10 17 5-5-5-5" />
      <path d="M15 12H3" />
    </svg>
  )
}

function IconUserCircle() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path d="M5 21v-1a7 7 0 0 1 14 0v1" />
    </svg>
  )
}

/** Compact account trigger — Heroicons-style user-in-circle (outline). */
function IconAccountGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M17.982 18.725A7.488 7.488 0 0 0 12 15.75a7.488 7.488 0 0 0-5.982 2.975m11.963 0a9 9 0 1 0-11.926 0m11.963 0A8.966 8.966 0 0 1 12 21a8.966 8.966 0 0 1-5.982-2.275M15 9.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
      />
    </svg>
  )
}

function IconBuilding() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
      <path d="M6 12h12" />
      <path d="M6 16h12" />
      <path d="M10 6h4" />
      <path d="M10 22v-4h4v4" />
    </svg>
  )
}

function IconCreditCard() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect width="20" height="14" x="2" y="5" rx="2" />
      <path d="M2 10h20" />
    </svg>
  )
}

function IconShieldSettings() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  )
}

function IconSignOut() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" x2="9" y1="12" y2="12" />
    </svg>
  )
}

function IconPinned() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}

function IconFolder() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h11a2 2 0 0 1 2 2z" />
    </svg>
  )
}

const MENU_ROW = { display: 'flex', alignItems: 'center', gap: 10 }

function menuHeadingSx(dk) {
  return {
    padding: '8px 12px 4px',
    marginTop: 2,
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: '0.09em',
    textTransform: 'uppercase',
    color: dk ? 'rgba(148,163,184,0.9)' : 'rgba(100,116,139,0.95)',
  }
}

function menuDividerSx(dk) {
  return {
    height: 1,
    margin: '8px 10px',
    background: dk ? 'rgba(148,163,184,0.22)' : 'rgba(15,23,42,0.08)',
  }
}

/** Guest CTAs — Go Premium + Sign In. */
function HmdaGuestAuth({ sprinkleMinimal }) {
  if (sprinkleMinimal) {
    return (
      <div className="hmda-header-auth">
        <Link
          to="/signup"
          className="hmda-header-cmd hmda-header-cmd--labeled toggle-theme hmda-header-cmd--sprinkle-signup"
          title="Go Premium"
          aria-label="Go Premium"
        >
          <span className="hmda-header-cmd__glyph" aria-hidden>
            <IconShoppingCart />
          </span>
          <span className="hmda-header-cmd__label">Go Premium</span>
        </Link>
        <Link
          to="/signin"
          className="hmda-header-cmd hmda-header-cmd--labeled toggle-theme"
          title="Sign in"
          aria-label="Sign in"
        >
          <span className="hmda-header-cmd__glyph" aria-hidden>
            <IconLogIn />
          </span>
          <span className="hmda-header-cmd__label">Sign In</span>
        </Link>
      </div>
    )
  }

  return (
    <div className="hmda-header-auth">
      <Link
        to="/signup"
        className="hmda-header-cmd hmda-header-cmd--primary"
        title="Go Premium"
        aria-label="Go Premium"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}
      >
        <span style={{ display: 'inline-flex' }} aria-hidden>
          <IconShoppingCart />
        </span>
        Go Premium
      </Link>
      <Link
        to="/signin"
        className="hmda-header-cmd"
        title="Sign in"
        aria-label="Sign in"
        style={{ textDecoration: 'none' }}
      >
        Sign In
      </Link>
    </div>
  )
}

/** Top nav: Go Premium + Sign In before theme (signup lives on /signin), or user menu when signed in. */
export function HmdaNavAuth({ dk, accent, surface, border, textMuted, isMobile, onOpenMenu, sprinkleMinimal }) {
  const { user, isSignedIn, isOrgAdmin, signOut } = useHmdaAuth()
  const [open, setOpen] = useState(false)
  const navRef = useRef(null)
  const navigate = useNavigate()

  const pill = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 11px',
    height: '34px',
    borderRadius: '9px',
    fontSize: '12px',
    fontWeight: 600,
    fontFamily: 'inherit',
    textDecoration: 'none',
    border: `1px solid ${border}`,
    transition: 'background 0.18s ease, color 0.18s ease, border-color 0.18s ease',
  }

  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0' }}>
        {!isSignedIn ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Link
              to="/signup"
              onClick={() => onOpenMenu?.(false)}
              style={{ ...pill, background: '#172B55', color: '#fff', borderColor: 'transparent', gap: 8 }}
            >
              <span style={{ display: 'inline-flex' }} aria-hidden>
                <IconShoppingCart />
              </span>
              Go Premium
            </Link>
            <Link
              to="/signin"
              onClick={() => onOpenMenu?.(false)}
              style={{ ...pill, background: surface, color: accent, borderColor: `${accent}55` }}
            >
              Sign In
            </Link>
          </div>
        ) : (
          <>
            <Link to="/account/profile" onClick={() => onOpenMenu?.(false)} style={{ ...pill, background: surface, color: dk ? '#e2e8f0' : '#0f172a', ...MENU_ROW }}>
              <span style={{ display: 'inline-flex', opacity: 0.92 }} aria-hidden>
                <IconUserCircle />
              </span>
              My Profile
            </Link>
            <Link to="/account/lender" onClick={() => onOpenMenu?.(false)} style={{ ...pill, background: surface, color: dk ? '#e2e8f0' : '#0f172a', ...MENU_ROW }}>
              <span style={{ display: 'inline-flex', opacity: 0.92 }} aria-hidden>
                <IconBuilding />
              </span>
              Lender Profile
            </Link>
            <Link to="/billing" onClick={() => onOpenMenu?.(false)} style={{ ...pill, background: surface, color: dk ? '#e2e8f0' : '#0f172a', ...MENU_ROW }}>
              <span style={{ display: 'inline-flex', opacity: 0.92 }} aria-hidden>
                <IconCreditCard />
              </span>
              Billing
            </Link>
            <Link to="/account/pins" onClick={() => onOpenMenu?.(false)} style={{ ...pill, background: surface, color: dk ? '#e2e8f0' : '#0f172a', ...MENU_ROW }}>
              <span style={{ display: 'inline-flex', opacity: 0.92 }} aria-hidden>
                <IconPinned />
              </span>
              Pinned list
            </Link>
            <Link to="/account/files" onClick={() => onOpenMenu?.(false)} style={{ ...pill, background: surface, color: dk ? '#e2e8f0' : '#0f172a', ...MENU_ROW }}>
              <span style={{ display: 'inline-flex', opacity: 0.92 }} aria-hidden>
                <IconFolder />
              </span>
              Files
            </Link>
            {isOrgAdmin && (
              <Link to="/admin/settings" onClick={() => onOpenMenu?.(false)} style={{ ...pill, background: surface, color: accent, ...MENU_ROW }}>
                <span style={{ display: 'inline-flex', opacity: 0.92 }} aria-hidden>
                  <IconShieldSettings />
                </span>
                Admin Settings
              </Link>
            )}
            <button
              type="button"
              onClick={() => {
                signOut()
                onOpenMenu?.(false)
                navigate('/')
              }}
              style={{ ...pill, background: 'transparent', color: textMuted, cursor: 'pointer', width: '100%', ...MENU_ROW }}
            >
              <span style={{ display: 'inline-flex', opacity: 0.92 }} aria-hidden>
                <IconSignOut />
              </span>
              Sign Out
            </button>
          </>
        )}
      </div>
    )
  }

  if (!isSignedIn) {
    return <HmdaGuestAuth sprinkleMinimal={sprinkleMinimal} />
  }

  return (
    <div ref={navRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className={`toggle-theme hmda-header-cmd hmda-header-cmd--account${sprinkleMinimal ? ' sprinkle-header-account-icon' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account menu"
        title="Account"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        <span className="hmda-header-account-avatar" aria-hidden>
          <IconAccountGlyph />
        </span>
        {!sprinkleMinimal ? 'Account' : null}
      </button>
      {open && (
        <>
          <div
            role="presentation"
            style={{ position: 'fixed', inset: 0, zIndex: 1998 }}
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            style={{
              position: 'absolute',
              right: 0,
              top: 'calc(100% + 8px)',
              zIndex: 1999,
              minWidth: 236,
              padding: 8,
              borderRadius: 16,
              background: dk ? 'rgba(15,23,42,0.96)' : 'rgba(255,255,255,0.96)',
              border: `1px solid ${border}`,
              boxShadow: '0 20px 45px rgba(15,23,42,0.12)',
              backdropFilter: 'blur(16px)',
            }}
          >
            {[
              { to: '/account/profile', label: 'My Profile', icon: <IconUserCircle /> },
              { to: '/account/lender', label: 'Lender Profile', icon: <IconBuilding /> },
              { to: '/income-intelligence', label: 'Income & Market Fit', icon: <IconShieldSettings /> },
              { to: '/billing', label: 'Billing', icon: <IconCreditCard /> },
            ].map((item) => (
              <Link
                key={item.to}
                to={item.to}
                role="menuitem"
                onClick={() => setOpen(false)}
                style={{
                  ...MENU_ROW,
                  padding: '10px 12px',
                  borderRadius: 10,
                  color: dk ? '#e2e8f0' : '#0f172a',
                  textDecoration: 'none',
                  fontSize: '13px',
                  fontWeight: 600,
                }}
              >
                <span style={{ display: 'inline-flex', opacity: 0.9, flexShrink: 0 }} aria-hidden>
                  {item.icon}
                </span>
                {item.label}
              </Link>
            ))}
            <div role="separator" style={menuDividerSx(dk)} />
            <div style={menuHeadingSx(dk)}>Pinned List</div>
            <Link
              to="/account/pins"
              role="menuitem"
              onClick={() => setOpen(false)}
              style={{
                ...MENU_ROW,
                padding: '10px 12px',
                borderRadius: 10,
                color: dk ? '#e2e8f0' : '#0f172a',
                textDecoration: 'none',
                fontSize: '13px',
                fontWeight: 600,
              }}
            >
              <span style={{ display: 'inline-flex', opacity: 0.9, flexShrink: 0 }} aria-hidden>
                <IconPinned />
              </span>
              Compare lenders &amp; bookmarks
            </Link>
            <div style={menuHeadingSx(dk)}>Files</div>
            <Link
              to="/account/files"
              role="menuitem"
              onClick={() => setOpen(false)}
              style={{
                ...MENU_ROW,
                padding: '10px 12px',
                borderRadius: 10,
                color: dk ? '#e2e8f0' : '#0f172a',
                textDecoration: 'none',
                fontSize: '13px',
                fontWeight: 600,
              }}
            >
              <span style={{ display: 'inline-flex', opacity: 0.9, flexShrink: 0 }} aria-hidden>
                <IconFolder />
              </span>
              Workspace uploads &amp; exports
            </Link>
            {isOrgAdmin ? (
              <>
                <div role="separator" style={menuDividerSx(dk)} />
                <Link
                  to="/admin/settings"
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  style={{
                    ...MENU_ROW,
                    padding: '10px 12px',
                    borderRadius: 10,
                    color: dk ? '#e2e8f0' : '#0f172a',
                    textDecoration: 'none',
                    fontSize: '13px',
                    fontWeight: 600,
                  }}
                >
                  <span style={{ display: 'inline-flex', opacity: 0.9, flexShrink: 0 }} aria-hidden>
                    <IconShieldSettings />
                  </span>
                  Admin Settings
                </Link>
              </>
            ) : null}
            <div role="separator" style={menuDividerSx(dk)} />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                signOut()
                navigate('/')
              }}
              style={{
                ...MENU_ROW,
                width: '100%',
                textAlign: 'left',
                padding: '10px 12px',
                marginTop: 0,
                borderRadius: 10,
                border: 'none',
                background: 'transparent',
                color: textMuted,
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <span style={{ display: 'inline-flex', opacity: 0.88 }} aria-hidden>
                <IconSignOut />
              </span>
              Sign Out
            </button>
          </div>
        </>
      )}
    </div>
  )
}
