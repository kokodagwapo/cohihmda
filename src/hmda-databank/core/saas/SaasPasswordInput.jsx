import React, { useId, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

/**
 * Password field with show/hide toggle (visibility only — value stays in React state).
 */
export default function SaasPasswordInput({
  id: idProp,
  label,
  value,
  onChange,
  autoComplete = 'current-password',
  placeholder,
  className = '',
  inputClassName = 'hmda-saas-input',
  tight = false,
}) {
  const autoId = useId()
  const inputId = idProp || autoId
  const [visible, setVisible] = useState(false)

  return (
    <div className={`hmda-saas-field${tight ? ' hmda-saas-field--tight' : ''} ${className}`.trim()}>
      {label ? <label htmlFor={inputId}>{label}</label> : null}
      <div className="hmda-saas-password-wrap">
        <input
          id={inputId}
          className={`${inputClassName} hmda-saas-password-wrap__input`}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          placeholder={placeholder}
        />
        <button
          type="button"
          className="hmda-saas-password-wrap__toggle"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          title={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? <EyeOff size={16} strokeWidth={2} aria-hidden /> : <Eye size={16} strokeWidth={2} aria-hidden />}
        </button>
      </div>
    </div>
  )
}
