// Compile-only: ConciseDateFormatter formats must be a 6-tuple (included by tsc, not run by test:oracle).
import { AutoDateLocator, ConciseDateFormatter } from '../src/index.ts';

function formatsMustBeSixTuple(): ConciseDateFormatter {
  const loc = new AutoDateLocator();
  // @ts-expect-error formats must be a 6-tuple
  return new ConciseDateFormatter(loc, { formats: ['%Y', '%b', '%d', '%H', '%M'] });
}

export type _FormatsMustBeSix = typeof formatsMustBeSixTuple;
