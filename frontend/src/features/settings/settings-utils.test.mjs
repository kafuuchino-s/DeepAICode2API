import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSettingsPatch, parseAliases, settingsToDraft } from './settings-utils.ts';

const base = {
  request_timeout_sec: 600, max_retries: 3, log_keep: 500, cors_origin: '', fallback_model: '', strict_model: false,
  rate_limit_rps: 0, rate_limit_burst: 0, key_concurrency: 0, checkin_block_ms: 0, preset_desktop_shape: false, model_aliases: { custom: 'model-a' }, admin_password_set: true,
};

test('explicit zeros survive settings load and save', () => {
  const draft = settingsToDraft(base);
  assert.equal(draft.rate_limit_rps, '0');
  assert.equal(draft.rate_limit_burst, '0');
  assert.equal(draft.key_concurrency, '0');
  const result = buildSettingsPatch(draft);
  const { admin_password_set: _ignored, ...expected } = base;
  assert.deepEqual(result.patch, expected);
});

test('aliases accept only a JSON object with string values', () => {
  assert.deepEqual(parseAliases(''), {});
  assert.deepEqual(parseAliases('{"example":"target"}'), { example: 'target' });
  for (const bad of ['null', '[]', '42', '{"a":1}', '{invalid']) assert.equal(parseAliases(bad), null);
  assert.deepEqual(buildSettingsPatch({ ...settingsToDraft(base), aliases: '{"a":3}' }), { error: 'aliases' });
});

test('invalid numeric values are rejected instead of silently ignored by the backend', () => {
  assert.deepEqual(buildSettingsPatch({ ...settingsToDraft(base), request_timeout_sec: '0' }), { error: 'number' });
  assert.deepEqual(buildSettingsPatch({ ...settingsToDraft(base), key_concurrency: '2.5' }), { error: 'number' });
  assert.deepEqual(buildSettingsPatch({ ...settingsToDraft(base), rate_limit_rps: '-1' }), { error: 'number' });
  for (const value of ['', '-1', '1.5', '9007199254740992']) assert.deepEqual(buildSettingsPatch({ ...settingsToDraft(base), checkin_block_ms: value }), { error: 'number' });
});

test('missing fields from older servers load as default values', () => {
  const { checkin_block_ms, preset_desktop_shape, ...old } = base;
  const draft = settingsToDraft(old);
  assert.equal(draft.checkin_block_ms, '0');
  assert.equal(draft.preset_desktop_shape, false);
  assert.equal(buildSettingsPatch({ ...draft, checkin_block_ms: '1250', preset_desktop_shape: true }).patch.checkin_block_ms, 1250);
});
