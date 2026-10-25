import assert from 'node:assert/strict';
import test from 'node:test';
import { formatLabValue } from '../src/lib/format.ts';

test('formats f32 lab values without binary precision noise', () => {
  assert.equal(formatLabValue(Math.fround(7.9)), '7.9');
  assert.equal(formatLabValue(Math.fround(8.2)), '8.2');
  assert.equal(formatLabValue(Math.fround(232)), '232');
  assert.equal(formatLabValue(Math.fround(0.0001234)), '0.0001234');
  assert.equal(formatLabValue(Math.fround(-7.9)), '-7.9');
});

test('preserves non-finite values as text', () => {
  assert.equal(formatLabValue(Number.NaN), 'NaN');
  assert.equal(formatLabValue(Number.POSITIVE_INFINITY), 'Infinity');
});
