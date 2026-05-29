/** HMDA warehouse data source: `db` (Prisma) or `static` (JSON files). */
export function hmdaDataSource() {
  const raw = String(process.env.HMDA_DATA_SOURCE || 'static').trim().toLowerCase()
  return raw === 'static' ? 'static' : 'db'
}

export function useHmdaWarehouse() {
  return hmdaDataSource() === 'db'
}

export async function isWarehouseReady() {
  if (!useHmdaWarehouse()) return false
  try {
    const { getWarehousePrisma } = await import('./warehouse-prisma.mjs')
    const prisma = getWarehousePrisma()
    const count = await prisma.lenderYearFact.count()
    return count > 0
  } catch {
    return false
  }
}
