import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TABS,
  TAB_IDS,
  applyGoal,
  defaultLayout,
  metaFor,
  moveTab,
  orderedTabs,
  parseLayout,
  serializeLayout,
  setEnabled,
  setPriority,
  visibleTabs,
} from '../spacetimedb/src/layout.ts';

test('the default layout turns on the core tabs and leaves diet and sleep off', () => {
  const layout = defaultLayout();
  assert.equal(layout.assessed, false);
  assert.equal(layout.tabs.length, TAB_IDS.length);
  assert.equal(layout.tabs.find(t => t.id === 'diet').on, false);
  assert.equal(layout.tabs.find(t => t.id === 'sleep').on, false);
  assert.equal(layout.tabs.find(t => t.id === 'vitals').on, true);
  for (const tab of layout.tabs) assert.equal(tab.priority, 'normal');
});

test('a layout survives a save and load round trip', () => {
  let layout = defaultLayout();
  layout = { ...layout, goal: 'keep an eye on sleep', assessed: true };
  layout = { tabs: setPriority(layout.tabs, 'sleep', 'high'), goal: layout.goal, assessed: true };
  layout = { ...layout, tabs: setEnabled(layout.tabs, 'sleep', true) };

  const restored = parseLayout(serializeLayout(layout));
  assert.equal(restored.goal, 'keep an eye on sleep');
  assert.equal(restored.assessed, true);
  assert.equal(restored.tabs.find(t => t.id === 'sleep').priority, 'high');
  assert.equal(restored.tabs.find(t => t.id === 'sleep').on, true);
});

test('a layout written by an older build still loads with every known tab', () => {
  const restored = parseLayout(
    JSON.stringify({ tabs: [{ id: 'sleep', on: true, priority: 'high' }], assessed: true })
  );
  assert.equal(restored.tabs.length, TAB_IDS.length);
  assert.equal(restored.tabs[0].id, 'sleep');
  assert.equal(restored.tabs[0].priority, 'high');
  // A tab the stored layout never mentioned falls back to its catalogue default.
  assert.equal(restored.tabs.find(t => t.id === 'vitals').on, true);
  assert.equal(restored.tabs.find(t => t.id === 'diet').on, false);
});

test('broken or hostile stored layouts fall back instead of throwing', () => {
  for (const raw of ['', '   ', 'not json', '[]', 'null', '42']) {
    const layout = parseLayout(raw);
    assert.equal(layout.tabs.length, TAB_IDS.length, `failed for ${JSON.stringify(raw)}`);
  }
  // Unknown ids, duplicates, and bad priorities are dropped or repaired.
  const restored = parseLayout(
    JSON.stringify({
      tabs: [
        { id: 'sleep', on: true, priority: 'urgent' },
        { id: 'sleep', on: false, priority: 'high' },
        { id: 'telepathy', on: true, priority: 'high' },
        null,
      ],
    })
  );
  assert.equal(restored.tabs.filter(t => t.id === 'sleep').length, 1);
  assert.equal(restored.tabs[0].priority, 'normal');
  assert.equal(restored.tabs.some(t => t.id === 'telepathy'), false);
});

test('moving a tab reorders it and keeps every other tab', () => {
  const layout = defaultLayout();
  const moved = moveTab(layout.tabs, 'sleep', -1);
  const sleepAt = moved.findIndex(t => t.id === 'sleep');
  const dietAt = moved.findIndex(t => t.id === 'diet');
  assert.equal(sleepAt, dietAt - 1);
  assert.equal(moved.length, layout.tabs.length);

  // Moving past either end is a no-op rather than an error.
  assert.deepEqual(moveTab(layout.tabs, layout.tabs[0].id, -1), layout.tabs);
  assert.deepEqual(moveTab(layout.tabs, layout.tabs[layout.tabs.length - 1].id, 1), layout.tabs);
  assert.deepEqual(moveTab(layout.tabs, 'nope', 1), layout.tabs);
});

test('high priority tabs sort above normal ones, and patient order breaks ties', () => {
  const layout = defaultLayout();
  const tabs = setPriority(layout.tabs, 'sleep', 'high');
  const order = orderedTabs(tabs).map(t => t.id);
  assert.equal(order[0], 'sleep');
  // Everything else keeps the patient's arrangement.
  assert.deepEqual(order.slice(1), layout.tabs.filter(t => t.id !== 'sleep').map(t => t.id));

  const twoHigh = setPriority(tabs, 'diet', 'high');
  const order2 = orderedTabs(twoHigh).map(t => t.id);
  assert.deepEqual(order2.slice(0, 2), ['diet', 'sleep']);
});

test('low priority tabs sort to the end', () => {
  const layout = defaultLayout();
  const tabs = setPriority(layout.tabs, 'check-ins', 'low');
  const order = orderedTabs(tabs).map(t => t.id);
  assert.equal(order[order.length - 1], 'check-ins');
});

test('hidden tabs are left out of the visible order', () => {
  const layout = defaultLayout();
  const tabs = setEnabled(layout.tabs, 'medications', false);
  const visible = visibleTabs(tabs, 'patient');
  assert.equal(visible.includes('medications'), false);
  assert.equal(visible.includes('vitals'), true);
  // Nurse-only tabs stay switched on but never reach the patient view.
  assert.equal(visible.length, tabs.filter(t => t.on && metaFor(t.id).patient).length);
  assert.equal(layout.tabs.every(t => metaFor(t.id).patient || metaFor(t.id).nurse), true);
});

test('the nursing assessment tab is nurse-only', () => {
  const layout = defaultLayout();
  assert.equal(TAB_IDS.includes('assessment'), true);
  assert.equal(metaFor('assessment').patient, false);
  assert.equal(metaFor('assessment').nurse, true);
  assert.equal(visibleTabs(layout.tabs, 'patient').includes('assessment'), false);
  assert.equal(visibleTabs(layout.tabs, 'nurse').includes('assessment'), true);
  const assessment = layout.tabs.find(t => t.id === 'assessment');
  assert.equal(assessment.on, true);
});

test('the initial assessment promotes the topics the patient names', () => {
  const layout = applyGoal(
    defaultLayout(),
    'I want to watch my sleep and what I eat, and keep my blood pressure in range'
  );
  assert.equal(layout.assessed, true);
  assert.equal(layout.goal.length > 0, true);
  const order = layout.tabs.map(t => t.id);
  // Named topics come first, in catalogue order, and are switched on at high priority.
  assert.deepEqual(order.slice(0, 3), ['vitals', 'diet', 'sleep']);
  for (const id of ['vitals', 'diet', 'sleep']) {
    const tab = layout.tabs.find(t => t.id === id);
    assert.equal(tab.priority, 'high');
    assert.equal(tab.on, true);
  }
  assert.equal(visibleTabs(layout.tabs, 'patient').includes('sleep'), true);
});

test('an assessment with no recognizable topic still completes', () => {
  const layout = applyGoal(defaultLayout(), 'I am not sure yet');
  assert.equal(layout.assessed, true);
  assert.equal(layout.tabs.length, TAB_IDS.length);
  assert.equal(layout.tabs.some(t => t.priority === 'high'), false);
});

test('the assessment understands medication and pain wording', () => {
  const meds = applyGoal(defaultLayout(), 'remind me about my insulin doses');
  assert.equal(meds.tabs[0].id, 'medications');
  const pain = applyGoal(defaultLayout(), 'I get a lot of pain and swelling in my knee');
  assert.equal(pain.tabs[0].id, 'check-ins');
});

test('a fitness goal brings exercise to the top and switches it on', () => {
  const layout = applyGoal(defaultLayout(), 'I want to get fitter, run more, and get stronger');
  assert.equal(layout.assessed, true);
  assert.equal(layout.tabs[0].id, 'exercise');
  const exercise = layout.tabs.find(t => t.id === 'exercise');
  assert.equal(exercise.on, true);
  assert.equal(exercise.priority, 'high');
});

test('a curious goal leads with the 3D twin', () => {
  const layout = applyGoal(defaultLayout(), 'I want to learn how my body works');
  assert.equal(layout.tabs[0].id, 'twin');
  const twin = layout.tabs.find(t => t.id === 'twin');
  assert.equal(twin.on, true);
  assert.equal(twin.priority, 'high');
});

test('exercise is a catalogued tab shown to both audiences by default', () => {
  assert.equal(TAB_IDS.includes('exercise'), true);
  const layout = defaultLayout();
  const exercise = layout.tabs.find(t => t.id === 'exercise');
  assert.equal(exercise.on, true);
  assert.equal(metaFor('exercise').patient, true);
  assert.equal(metaFor('exercise').nurse, true);
  assert.equal(visibleTabs(layout.tabs, 'patient').includes('exercise'), true);
  assert.equal(visibleTabs(layout.tabs, 'nurse').includes('exercise'), true);
});

test('every catalogued tab has copy for both audiences', () => {
  for (const tab of TABS) {
    assert.equal(typeof tab.label, 'string');
    assert.equal(tab.label.length > 0, true);
    assert.equal(tab.hint.length > 0, true);
    assert.equal(tab.patient || tab.nurse, true);
  }
  assert.equal(metaFor('diet').label, 'Diet');
});
