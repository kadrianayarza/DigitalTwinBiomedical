// "Take me to …" commands typed or spoken to the assistants resolve to a tab.
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchNavCommand, TAB_ALIASES, TAB_IDS, TABS } from '../spacetimedb/src/layout.ts';

test('every tab has at least one lowercase alias', () => {
  for (const id of TAB_IDS) {
    const aliases = TAB_ALIASES[id];
    assert.ok(Array.isArray(aliases) && aliases.length > 0, `${id} has aliases`);
    for (const a of aliases) assert.equal(a, a.toLowerCase(), `${id} alias "${a}" is lowercase`);
  }
  // Aliases cover every catalogue entry exactly once.
  assert.deepEqual(Object.keys(TAB_ALIASES).sort(), [...TAB_IDS].sort());
  assert.equal(TABS.length, TAB_IDS.length);
});

test('navigation verbs plus an alias resolve to the right tab', () => {
  assert.equal(matchNavCommand('take me to the health tab'), 'health-record');
  assert.equal(matchNavCommand('show me my appointments'), 'schedule');
  assert.equal(matchNavCommand('go to sleep'), 'sleep');
  assert.equal(matchNavCommand('open the 3d twin'), 'twin');
  assert.equal(matchNavCommand('bring up my meds'), 'medications');
  assert.equal(matchNavCommand('navigate to vital signs'), 'vitals');
  assert.equal(matchNavCommand('pull up the exercise tab'), 'exercise');
  assert.equal(matchNavCommand('take me to the nursing assessment'), 'assessment');
  assert.equal(matchNavCommand('show me the chart'), 'health-record');
  assert.equal(matchNavCommand('take me back to check ins'), 'check-ins');
  assert.equal(matchNavCommand('let me see my devices'), 'devices');
  assert.equal(matchNavCommand('switch to diet'), 'diet');
});

test('the longest alias wins, so mental health does not land on the record', () => {
  assert.equal(matchNavCommand('take me to mental health'), 'mood');
  assert.equal(matchNavCommand('show me my health history'), 'history');
  assert.equal(matchNavCommand('open the medical record'), 'health-record');
});

test('ordinary questions and statements are not navigation commands', () => {
  assert.equal(matchNavCommand('what do my vitals mean'), null);
  assert.equal(matchNavCommand('how am I doing today'), null);
  assert.equal(matchNavCommand('my results show high glucose'), null);
  assert.equal(matchNavCommand('how open is my schedule this week'), null);
  assert.equal(matchNavCommand('take me somewhere nice'), null);
  assert.equal(matchNavCommand(''), null);
});

test('matching is case-insensitive and punctuation tolerant', () => {
  assert.equal(matchNavCommand('TAKE ME TO THE HEALTH TAB'), 'health-record');
  assert.equal(matchNavCommand('Take me to my appointments, please'), 'schedule');
  assert.equal(matchNavCommand('hey, can you show me my mood?'), 'mood');
});
