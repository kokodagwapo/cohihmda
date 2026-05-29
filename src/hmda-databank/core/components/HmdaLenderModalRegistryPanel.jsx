import React from "react"
import { nmlsConsumerAccessCompanyUrl } from '@hmda/utils/hmdaFfiecLive.js'

function RegistryRow({ label, value, source, mono = false, loading = false, href, c }) {
  const content = loading ? (
    <span className="hmda-lender-registry__placeholder">Loading…</span>
  ) : value != null && value !== "" && value !== "—" ? (
    href ? (
      <a href={href} target="_blank" rel="noopener noreferrer" className="hmda-lender-registry__link" style={{ color: c.accent }}>
        {value}
      </a>
    ) : (
      <span className={mono ? "hmda-lender-registry__value--mono" : "hmda-lender-registry__value"}>{value}</span>
    )
  ) : (
    <span className="hmda-lender-registry__placeholder">—</span>
  )

  return (
    <div className="hmda-lender-registry__row">
      <div className="hmda-lender-registry__label">{label}</div>
      <div className="hmda-lender-registry__cell">
        {content}
        {source ? <span className="hmda-lender-registry__source">{source}</span> : null}
      </div>
    </div>
  )
}

export default function HmdaLenderModalRegistryPanel({
  lender,
  registry,
  registryLoading,
  fmtAddress,
  fmtBranchSitesCell,
  branchSourceLabel,
  c,
  IC,
}) {
  const gleif = registry?.gleif
  const fdic = registry?.fdic
  const ncua = registry?.ncua
  const nmlsUrl = registry?.nmls?.url || nmlsConsumerAccessCompanyUrl(lender?.nmls)
  const nmlsId = registry?.nmls?.id || String(lender?.nmls || "").replace(/\D/g, "") || "—"
  const websiteUrl = registry?.website?.url || lender?.website || null
  const websiteSource = registry?.website?.source || (lender?.websiteVerified ? "Company website" : "Company website")
  const legalAddr =
    gleif?.legalAddressText ||
    (gleif?.legalAddress ? fmtAddress(gleif.legalAddress) : null) ||
    fdic?.addressText ||
    null
  const hqAddr =
    gleif?.hqAddressText ||
    (gleif?.hqAddress ? fmtAddress(gleif.hqAddress) : null) ||
    legalAddr
  const phone = gleif?.phone || null
  const branchVal = fmtBranchSitesCell(lender)
  const branchSrc = branchSourceLabel(lender) || registry?.hmda?.branchSource || lender?.branchSource || "HMDA"
  const branchLabel =
    branchSrc === "FDIC SOD" || String(branchSrc).startsWith("FDIC") ? "Branches (FDIC)" : branchSrc === "NCUA" || String(branchSrc).startsWith("NCUA") ? "Branches (NCUA)" : "Geography (counties)"
  const states = lender?.states != null ? String(lender.states) : registry?.hmda?.states != null ? String(registry.hmda.states) : "—"
  const searchQ = encodeURIComponent(`${lender?.name || ""} mortgage`)

  return (
    <div className="hmda-lender-registry">
      <RegistryRow
        label="Legal name"
        value={gleif?.legalName || lender?.name}
        source={gleif?.legalName ? "GLEIF" : "HMDA"}
        loading={registryLoading && !gleif}
        c={c}
      />
      {gleif?.dba ? <RegistryRow label="DBA" value={gleif.dba} source="GLEIF" c={c} /> : null}
      <RegistryRow label="LEI" value={lender?.lei || registry?.hmda?.lei} source="HMDA" mono loading={registryLoading && !lender?.lei} c={c} />
      <RegistryRow label="Headquarters" value={hqAddr} source={gleif?.hqAddressText || gleif?.hqAddress ? "GLEIF" : fdic ? "FDIC" : null} loading={registryLoading && !gleif && !fdic} c={c} />
      <RegistryRow label="Legal address" value={legalAddr} source={gleif?.legalAddress ? "GLEIF" : fdic ? "FDIC" : null} loading={registryLoading && !gleif && !fdic} c={c} />
      <RegistryRow label="Phone" value={phone} source={phone ? "GLEIF" : null} mono loading={registryLoading && !gleif} c={c} />
      <RegistryRow label="States (HMDA)" value={states} source="HMDA" c={c} />
      <RegistryRow label={branchLabel} value={branchVal} source={branchSrc} c={c} />
      {fdic?.cert ? <RegistryRow label="FDIC cert" value={fdic.cert} source="FDIC" mono c={c} /> : null}
      {ncua?.branchCount != null ? <RegistryRow label="NCUA branches" value={String(ncua.branchCount)} source="NCUA" c={c} /> : null}
      <RegistryRow
        label="NMLS"
        value={nmlsId}
        source="NMLS"
        mono
        href={nmlsUrl}
        c={c}
      />
      <RegistryRow
        label="Website"
        value={websiteUrl ? (websiteUrl.replace(/^https?:\/\//, "").slice(0, 48) + (websiteUrl.length > 52 ? "…" : "")) : null}
        source={websiteUrl ? websiteSource : null}
        href={websiteUrl || undefined}
        c={c}
      />

      <div className="hmda-lender-registry__actions">
        {websiteUrl ? (
          <a href={websiteUrl} target="_blank" rel="noopener noreferrer" className="hmda-lender-modal-contact-btn hmda-lender-modal-contact-btn--primary">
            {IC?.ext || null} Official site
          </a>
        ) : null}
        {nmlsUrl ? (
          <a href={nmlsUrl} target="_blank" rel="noopener noreferrer" className="hmda-lender-modal-contact-btn">
            NMLS profile
          </a>
        ) : null}
        <a href={`https://www.google.com/search?q=${searchQ}`} target="_blank" rel="noopener noreferrer" className="hmda-lender-modal-contact-btn">
          Google search
        </a>
        <a href={`https://www.bing.com/search?q=${searchQ}`} target="_blank" rel="noopener noreferrer" className="hmda-lender-modal-contact-btn">
          Bing search
        </a>
        <a href={`https://ffiec.cfpb.gov/data-browser/entity/${encodeURIComponent(lender?.lei || "")}`} target="_blank" rel="noopener noreferrer" className="hmda-lender-modal-contact-btn">
          FFIEC Data Browser
        </a>
      </div>
    </div>
  )
}
