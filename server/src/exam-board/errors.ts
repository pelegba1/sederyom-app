import type { ExamBoardError } from '@sederyom/shared';

/** A refusal in the exam board's server code; the route turns it into a 4xx with this code as the `error`. */
export class BoardError extends Error {
  constructor(readonly code: ExamBoardError) {
    super(code);
    this.name = 'BoardError';
  }
}
