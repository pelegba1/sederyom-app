/**
 * A failure the screens can show: `message` is Hebrew, ready for the screen,
 * and `status` the HTTP status when one came with it (0 for none). The phone
 * answers the screens itself (`local/phoneApi.ts`).
 */
export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}
