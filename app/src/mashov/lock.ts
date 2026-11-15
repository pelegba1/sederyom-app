/**
 * One job at a time on the phone's Mashov session (`withMashovSession`). The
 * scan of a parent's schools (`parentSchools.ts`) moves the session from school
 * to school; a read or the built-in check running at the same moment would
 * read the wrong school. Jobs run one after another, in the order they were
 * asked for, and a job that throws does not block the next.
 *
 * Not reentrant: a job that asks for the lock again waits for itself forever.
 * Code that already holds it calls the inner functions that do not take it.
 */
let last: Promise<unknown> = Promise.resolve();

export function withMashovSession<T>(job: () => Promise<T>): Promise<T> {
  const result = last.then(job);
  last = result.catch(() => undefined);
  return result;
}

/**
 * Settles once every job asked for so far has finished, a failed one too:
 * "מחק את הנתונים שלי" waits for it (`deleteMyDataRun.ts`), so a scan or the
 * check in the middle does not write the parent's children back into the
 * storage the delete wipes. Never rejects.
 */
export function mashovSessionIdle(): Promise<void> {
  return last.then(() => undefined, () => undefined);
}
