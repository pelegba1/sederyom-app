/**
 * A school's Shahaf timetable site, by its one address: `https://<school>.shahaf.site`.
 *
 * One rule for the server and the phone. The server fetches the address a
 * device sends (`/v2/classes`, `PUT /v2/device`), so it takes nothing but the
 * bare address (`normalizeShahafUrl`). The phone also meets it as text a
 * student pasted from the browser, or as Mashov's answer, and keeps only the
 * site out of it (`shahafSiteOf`) before the same rule.
 */

/**
 * A Shahaf site's address, normalized to `https://<school>.shahaf.site`, or
 * `null` for anything else.
 *
 * The device supplies this (Mashov's `/api/shahaf/coolSite` answers it, or the
 * student pastes it), and the server then fetches it: accepting any URL would
 * let anyone make the server fetch any host. So it is a Shahaf subdomain or
 * nothing — no path, no port, no credentials, no other domain.
 */
export function normalizeShahafUrl(input: string): string | null {
  const m = /^\s*(?:https?:\/\/)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.shahaf\.site\/?\s*$/i.exec(input);
  if (!m) return null;
  const sub = m[1]!.toLowerCase();
  if (sub === 'www') return null;
  return `https://${sub}.shahaf.site`;
}

/** Direction marks a copy from a right-to-left page can carry around a link. */
const BIDI_MARKS = /[‎‏‪-‮⁦-⁩]/g;

/**
 * The site in what a student pasted, or Mashov named: the address as the
 * browser shows it, with or without `https://`, and with whatever page,
 * query or anchor follows the host (`https://ironi-d.shahaf.site/?tab=…`).
 * Only the part before the first `/`, `?` or `#` after the host is kept, and
 * it must pass `normalizeShahafUrl`: a port, credentials, a deeper subdomain
 * or another domain is still `null`.
 */
export function shahafSiteOf(input: string): string | null {
  const text = input.replace(BIDI_MARKS, '').trim();
  const m = /^(?:https?:\/\/)?([^/?#\s]+)(?:[/?#]\S*)?$/i.exec(text);
  return m ? normalizeShahafUrl(m[1]!) : null;
}
