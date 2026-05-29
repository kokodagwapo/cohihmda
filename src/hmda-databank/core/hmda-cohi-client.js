/** Client-side upload checks — align with server/hmda-cohi-upload-security.mjs */

export const MAX_CSV_BYTES = 2 * 1024 * 1024
export const MAX_XLSX_BYTES = 3 * 1024 * 1024

export async function assertExcelMagicSlice(file) {
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

export async function assertCsvTextSlice(file) {
  const n = Math.min(file.size, 8192)
  if (n === 0) throw new Error('Empty file.')
  const u8 = new Uint8Array(await file.slice(0, n).arrayBuffer())
  let nulls = 0
  for (let i = 0; i < u8.length; i++) {
    const b = u8[i]
    if (b === 0) nulls++
    else if (b < 32 && b !== 9 && b !== 10 && b !== 13) {
      throw new Error('CSV must be plain text. Binary content rejected.')
    }
  }
  if (u8.length && nulls / u8.length > 0.002) throw new Error('CSV appears binary — use UTF-8 text export.')
}

export async function validateUploadFile(kind, file) {
  const lower = String(file.name || '').toLowerCase()
  if (kind === 'csv') {
    if (!lower.endsWith('.csv')) throw new Error('Choose a .csv file.')
    if (file.size > MAX_CSV_BYTES) throw new Error(`CSV must be under ${MAX_CSV_BYTES / (1024 * 1024)} MB.`)
    await assertCsvTextSlice(file)
    return
  }
  if (!/\.(xlsx|xls)$/i.test(lower)) throw new Error('Choose .xlsx or .xls.')
  if (/\.(xlsm|xlsb)$/i.test(lower)) throw new Error('Macro-enabled Excel is not accepted.')
  if (file.size > MAX_XLSX_BYTES) throw new Error(`Excel must be under ${MAX_XLSX_BYTES / (1024 * 1024)} MB.`)
  await assertExcelMagicSlice(file)
}

export async function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => reject(r.error)
    r.readAsText(file)
  })
}

export async function readFileAsBase64(file) {
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

export function detectUploadKind(file) {
  const lower = String(file?.name || '').toLowerCase()
  if (lower.endsWith('.csv')) return 'csv'
  if (/\.(xlsx|xls)$/i.test(lower)) return 'xlsx'
  return null
}
