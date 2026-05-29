import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis

/** @type {PrismaClient | undefined} */
let client = globalForPrisma.__hmdaWarehousePrisma

export function getWarehousePrisma() {
  if (!client) {
    client = new PrismaClient()
    if (process.env.NODE_ENV !== 'production') {
      globalForPrisma.__hmdaWarehousePrisma = client
    }
  }
  return client
}

export async function disconnectWarehousePrisma() {
  if (client) {
    await client.$disconnect()
    client = undefined
    delete globalForPrisma.__hmdaWarehousePrisma
  }
}
