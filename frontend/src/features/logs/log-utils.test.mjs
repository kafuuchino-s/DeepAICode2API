import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyFilters, filtersFromHash, filtersToHash, filtersToQuery, formatCost, logOutcome, observedValue } from './log-utils.ts';

test('log links retain the filters and translate local time for the API', () => {
  const filters = { ...emptyFilters, endpoint: 'responses', account: 'a+b@example.com', min_status: '400', q: '错误 & model', since: '2026-01-02T15:30', limit: '50' };
  const hash = filtersToHash(filters);
  assert.deepEqual(filtersFromHash(hash), filters);
  const query = new URLSearchParams(filtersToQuery(filters));
  assert.equal(query.get('account'), filters.account);
  assert.equal(query.get('q'), filters.q);
  assert.equal(query.get('since'), String(Math.floor(new Date(filters.since).getTime() / 1000)));
  assert.equal(query.get('limit'), '50');
  assert.equal(filtersFromHash('#logs?limit=0').limit, '200');
  assert.equal(new URLSearchParams(filtersToQuery({ ...emptyFilters, limit: '0' })).get('limit'), '200');
});

test('usage presence distinguishes known zero from ambiguous historical zero', () => {
  assert.equal(observedValue(0), null);
  assert.equal(observedValue(undefined), null);
  assert.equal(observedValue(0, true), 0);
  assert.equal(observedValue(undefined, true), 0); // omitempty may omit a reported zero
  assert.equal(observedValue(2.5), 2.5);
  assert.equal(observedValue(0, false), null);
  assert.equal(observedValue(2.5, false), null);
});

test('cost text preserves tiny charges while distinguishing reported zero and unknown', () => {
  assert.equal(formatCost(0, undefined, 'Unknown'), 'Unknown');
  assert.equal(formatCost(0, true, 'Unknown'), '$0.000000');
  assert.equal(formatCost(0.000000000001, true, 'Unknown'), '$1e-12');
  assert.equal(formatCost(0.25, false, 'Unknown'), 'Unknown');
});

test('499 is not a failure even with an error; an error with 200 is a failure', () => {
  assert.equal(logOutcome({ status: 499, err: 'client gone' }), 'client-gone');
  assert.equal(logOutcome({ status: 200, err: 'upstream error' }), 'failed');
  assert.equal(logOutcome({ status: 500 }), 'failed');
  assert.equal(logOutcome({ status: 200 }), 'success');
});
