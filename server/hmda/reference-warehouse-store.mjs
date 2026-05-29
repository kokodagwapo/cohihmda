import { getWarehousePrisma } from './warehouse-prisma.mjs'

export async function getStateIncomeMapFromDb() {
  const prisma = getWarehousePrisma()
  const rows = await prisma.referenceStateIncome.findMany()
  return Object.fromEntries(rows.map((r) => [r.stateCode, r.medianIncome]))
}

export async function getLenderOverridesFromDb(lei) {
  const prisma = getWarehousePrisma()
  const rows = await prisma.lenderContentOverride.findMany({
    where: { lei: String(lei).toUpperCase() },
  })
  const out = {}
  for (const r of rows) {
    try {
      out[r.fieldKey] = JSON.parse(r.fieldValue)
    } catch {
      out[r.fieldKey] = r.fieldValue
    }
  }
  return out
}

export async function getLeiNmlsFromDb(lei) {
  const prisma = getWarehousePrisma()
  const row = await prisma.lenderIdentifier.findUnique({
    where: { lei: String(lei).toUpperCase() },
  })
  return row?.nmls || null
}

export async function getPreloaderLenderCountFromDb(year = 2025) {
  const prisma = getWarehousePrisma()
  const count = await prisma.lenderYearFact.count({ where: { year: Number(year) } })
  return count > 0 ? count : null
}
