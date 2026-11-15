/**
 * What the server logs through: `console` in production, a silent stub in
 * tests. Structured first, message second, as Fastify's logger takes them.
 */
export interface Logger {
  info: (o: unknown, m?: string) => void;
  warn: (o: unknown, m?: string) => void;
  error: (o: unknown, m?: string) => void;
}
