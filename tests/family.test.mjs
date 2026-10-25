import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  FAMILY_CODE_LENGTH,
  familyMessage,
  formatInviteCode,
  hashFamilyPassword,
  isValidEmail,
  makeInviteCode,
  normalizeEmail,
  normalizeInviteCode,
  passwordProblem,
  sameDigest,
  sha256Hex,
  shouldNotifyFamily,
} from '../spacetimedb/src/family.ts';

test('invite codes are the right length and avoid look-alike characters', () => {
  let n = 0;
  for (let i = 0; i < 200; i++) {
    const code = makeInviteCode(max => (n++ * 7) % max);
    assert.equal(code.length, FAMILY_CODE_LENGTH);
    assert.equal(/[01OIL]/.test(code), false, code);
  }
});

test('a code is accepted however the family member types it', () => {
  assert.equal(normalizeInviteCode(' abc-234 '), 'ABC234');
  assert.equal(normalizeInviteCode('ABC 234'), 'ABC234');
  assert.equal(normalizeInviteCode(formatInviteCode('ABC234')), 'ABC234');
  assert.equal(formatInviteCode('ABC234'), 'ABC-234');
});

test('"major changes" covers same-day reviews and emergencies only', () => {
  assert.equal(shouldNotifyFamily('major', 'routine'), false);
  assert.equal(shouldNotifyFamily('major', 'review_24h'), false);
  assert.equal(shouldNotifyFamily('major', 'same_day'), true);
  assert.equal(shouldNotifyFamily('major', 'emergency'), true);
});

test('"emergencies only" ignores everything below an emergency', () => {
  assert.equal(shouldNotifyFamily('urgent', 'same_day'), false);
  assert.equal(shouldNotifyFamily('urgent', 'emergency'), true);
  assert.equal(shouldNotifyFamily('urgent', 'nonsense'), false);
});

test('an emergency message tells the family to make sure help is on the way', () => {
  const m = familyMessage('opened', 'emergency', 'PE_SIGNS', 'Grace');
  assert.match(m.title, /Urgent/);
  assert.match(m.title, /Grace/);
  assert.match(m.body, /chest pain or trouble breathing/);
  assert.match(m.body, /911/);
});

test('family wording avoids the clinical abbreviations nurses see', () => {
  const m = familyMessage('opened', 'same_day', 'DVT_SIGNS,FEVER,TACHYCARDIA', 'Tom');
  assert.match(m.body, /blood clot/);
  assert.match(m.body, /a fever and a fast heart rate/);
  assert.equal(/DVT|bpm|mmHg|SpO2/.test(m.title + m.body), false);
});

test('unknown reason codes still produce a readable message', () => {
  const m = familyMessage('raised', 'same_day', 'SOMETHING_NEW', 'Mei');
  assert.match(m.body, /a change in their health/);
  assert.match(m.title, /closer look today/);
});

test('a resolved message reassures without asking for action', () => {
  const m = familyMessage('resolved', 'same_day', 'INFECTION_SIGNS', 'Robert');
  assert.match(m.title, /resolved/);
  assert.match(m.body, /No action is needed/);
});

test('sha256 matches the standard test vectors', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(
    sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
  );
  assert.equal(sha256Hex('é'), crypto.createHash('sha256').update('é').digest('hex'));
});

test('family passwords hash the same way every time, but differ by salt', () => {
  const a = hashFamilyPassword('correct horse', 'aa11', 50);
  assert.equal(a, hashFamilyPassword('correct horse', 'aa11', 50));
  assert.notEqual(a, hashFamilyPassword('correct horse', 'bb22', 50));
  assert.notEqual(a, hashFamilyPassword('correct horsf', 'aa11', 50));
  assert.equal(a.length, 64);
  assert.equal(sameDigest(a, a), true);
  assert.equal(sameDigest(a, hashFamilyPassword('x', 'aa11', 50)), false);
});

test('family login emails and passwords are checked plainly', () => {
  assert.equal(normalizeEmail('  Ana.Becker@Example.COM '), 'ana.becker@example.com');
  assert.equal(isValidEmail('ana@example.com'), true);
  assert.equal(isValidEmail('ana@example'), false);
  assert.equal(isValidEmail('ana example.com'), false);
  assert.match(passwordProblem('short') ?? '', /at least 8/);
  assert.equal(passwordProblem('long enough'), null);
  assert.notEqual(passwordProblem('        '), null);
});
