import assert from 'node:assert/strict';
import test from 'node:test';
import {
  UNCERTAINTY_SYSTEM_PROMPT,
  parseUncertainties,
  uncertaintyRequestBody,
} from '../spacetimedb/src/clinical.ts';

const draft = { situation: 'S text', background: 'B text', assessment: 'A text', recommendation: 'R text' };

test('the uncertainty request sends the record and the draft under its own system prompt', () => {
  const body = uncertaintyRequestBody('some-model', '{"patient":{}}', draft);
  assert.equal(body.model, 'some-model');
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(body.messages[0].content, UNCERTAINTY_SYSTEM_PROMPT);
  assert.match(body.messages[1].content, /\{"patient":\{\}\}/);
  assert.match(body.messages[1].content, /S: S text\nB: B text\nA: A text\nR: R text/);
});

test('uncertainties are read from plain or wrapped JSON and tidied', () => {
  assert.deepEqual(parseUncertainties('{"uncertainties":["  No check-ins\\n yet ", "", 3, "SpO2 is borderline"]}'), [
    'No check-ins yet',
    'SpO2 is borderline',
  ]);
  assert.deepEqual(parseUncertainties('Here you go:\n```json\n{"uncertainties":["One"]}\n```'), ['One']);
  assert.equal(parseUncertainties('{"uncertainties":["a","b","c","d","e","f"]}').length, 5);
});

test('unusable replies return null so the draft keeps its own uncertainties', () => {
  assert.equal(parseUncertainties(''), null);
  assert.equal(parseUncertainties('not json'), null);
  assert.equal(parseUncertainties('{"uncertainties":[]}'), null);
  assert.equal(parseUncertainties('{"items":["x"]}'), null);
});
