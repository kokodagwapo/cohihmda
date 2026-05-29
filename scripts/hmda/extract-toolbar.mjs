import fs from 'fs'

const path = new URL('../../src/hmda-databank/core/MortgageLenderDashboard.jsx', import.meta.url)
let s = fs.readFileSync(path, 'utf8')

if (s.includes('const hmdaLendersToolbarBarUi')) {
  console.log('already extracted')
  process.exit(0)
}

const idx = s.indexOf('data-demo-target="filter-bar"')
if (idx < 0) throw new Error('filter bar not found')

const mobileStart = s.indexOf('{isMobile ? (', idx)
const pinnedStart = s.indexOf('{isMobile&&(', mobileStart)
if (mobileStart < 0 || pinnedStart < 0) {
  throw new Error(`toolbar block not found mobile=${mobileStart} pinned=${pinnedStart}`)
}

const ternaryBlock = s.slice(mobileStart, pinnedStart).replace(/\s*\)\s*\}\s*$/, '')
const toolbarInner = ternaryBlock.slice('{isMobile ? ('.length).trim()
const varDef = `  const hmdaLendersToolbarBarUi = isMobile ? (\n${toolbarInner}\n  );\n\n`

s = s.slice(0, mobileStart) + '{hmdaLendersToolbarBarUi}' + s.slice(pinnedStart)
if (!s.includes('hmda-lenders-tab-stack')) throw new Error('lenders tab stack missing after extract')

if (!s.includes('     RENDER')) throw new Error('RENDER marker not found')
s = s.replace('     RENDER', `${varDef.trimEnd()}\n     RENDER`)

fs.writeFileSync(path, s)
console.log('ok — extracted', toolbarInner.length, 'chars')
