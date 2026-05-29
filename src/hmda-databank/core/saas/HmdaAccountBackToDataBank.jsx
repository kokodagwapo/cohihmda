import { Link } from 'react-router-dom'

/** Primary escape hatch — consistent across Coheus Light account / workspace pages */
export default function HmdaAccountBackToDataBank({ hint = 'Public market explorer' }) {
  return (
    <div className="hmda-account-back">
      <Link to="/" className="hmda-account-back__link" aria-label="Return to HMDA DataBank — public market explorer">
        <span className="hmda-account-back__arrow" aria-hidden>
          ←
        </span>
        <span>HMDA DataBank</span>
      </Link>
      {hint ? <span className="hmda-account-back__hint">{hint}</span> : null}
    </div>
  )
}
