// The care-team conversation: body validation, tab registration, goal promotion.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MESSAGE_MAX,
  canPostToChannel,
  channelsForRole,
  cleanMessageBody,
  isMessageChannel,
} from '../spacetimedb/src/messages.ts';
import { applyGoal, defaultLayout, matchNavCommand, metaFor, TAB_ALIASES, TAB_IDS } from '../spacetimedb/src/layout.ts';

test('message bodies are trimmed and blank ones rejected', () => {
  assert.equal(cleanMessageBody('  hello nurse  '), 'hello nurse');
  assert.equal(cleanMessageBody('a\n\n\n\nb'), 'a\n\nb');
  assert.throws(() => cleanMessageBody('   '), /Write a message first/);
  assert.throws(() => cleanMessageBody(''), /Write a message first/);
});

test('over-long messages are rejected with a user-facing error', () => {
  assert.equal(cleanMessageBody('x'.repeat(MESSAGE_MAX)).length, MESSAGE_MAX);
  assert.throws(() => cleanMessageBody('x'.repeat(MESSAGE_MAX + 1)), /under 1000 characters/);
});

test('the messages tab is registered for both audiences with aliases', () => {
  assert.ok(TAB_IDS.includes('messages'));
  const meta = metaFor('messages');
  assert.equal(meta.label, 'Messages');
  assert.ok(meta.patient && meta.nurse);
  assert.ok(TAB_ALIASES['messages'].length > 0);
});

test('asking to stay in touch promotes the messages tab', () => {
  const layout = applyGoal(defaultLayout(), 'I want to stay in touch with my nurse by message');
  assert.equal(layout.tabs[0].id, 'messages');
  assert.equal(layout.tabs[0].priority, 'high');
  assert.equal(layout.tabs[0].on, true);
});

test('voice navigation can open the conversation', () => {
  assert.equal(matchNavCommand('open my messages'), 'messages');
  assert.equal(matchNavCommand('take me to the chat'), 'messages');
  assert.equal(matchNavCommand('show me the conversation'), 'messages');
});

test('the patient is in every channel; nurse and family get their own private one', () => {
  assert.deepEqual([...channelsForRole('patient')], ['team', 'nurse', 'family']);
  assert.deepEqual([...channelsForRole('nurse')], ['team', 'nurse']);
  assert.deepEqual([...channelsForRole('family')], ['team', 'family']);
});

test('posting rules keep side channels private', () => {
  assert.ok(canPostToChannel('patient', 'family'));
  assert.ok(canPostToChannel('nurse', 'nurse'));
  assert.ok(!canPostToChannel('nurse', 'family'));
  assert.ok(!canPostToChannel('family', 'nurse'));
  assert.ok(canPostToChannel('family', 'team'));
});

test('channel names are validated', () => {
  assert.ok(isMessageChannel('team'));
  assert.ok(isMessageChannel('nurse'));
  assert.ok(isMessageChannel('family'));
  assert.ok(!isMessageChannel('everyone'));
  assert.ok(!isMessageChannel(''));
});
