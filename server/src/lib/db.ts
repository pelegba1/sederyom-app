import { PrismaClient } from '@prisma/client';

let client: PrismaClient | null = null;

export function db(): PrismaClient {
  client ??= new PrismaClient();
  return client;
}

export async function disconnectDb(): Promise<void> {
  await client?.$disconnect();
  client = null;
}
