/**
 * A URL with a query string, built by hand: React Native's `URL` does not
 * implement `searchParams.set`, and this code runs on the phone too.
 * Undefined and null values are left out.
 */
export function withQuery(base: string, params: Record<string, string | number | boolean | null | undefined>): string {
  const query = Object.entries(params)
    .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined && entry[1] !== null)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  return query ? `${base}?${query}` : base;
}
