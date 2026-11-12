// tools/replay-core.ts decode: $date/$dates become ECMAScript date-time strings before Date parses them, so every engine reads the
// same instant. `s + 'Z'` gave Invalid Date in JavaScriptCore for a date alone (Date.parse('2025-01-01Z') is NaN in Mobile Safari 18.6).
import assert from 'node:assert/strict';
import { decode, utcIso } from '../tools/replay-core.ts';

const FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?Z$/;   // ECMA-262 Date Time String Format, UTC
for (const s of ['2025-01-01', '2026-11-05T14:10', '2026-11-05T14:10:07', '2026-11-05T14:10:07.5', '2026-11-05T14:10:07.123456789']) {
  assert.match(utcIso(s), FORMAT, s);
  assert.equal(Date.parse(utcIso(s)), Date.parse(`${s}Z`), `${s}: the instant V8 read before`);
}
const [d] = decode({ $dates: ['2025-01-01'] }) as Date[];
assert.equal(d?.getTime(), Date.UTC(2025, 0, 1));
assert.equal((decode({ $date: '2026-11-05T14:10:07.123456' }) as Date).getTime(), Date.UTC(2026, 10, 5, 14, 10, 7, 123));
console.log('replay-dates: ok');
