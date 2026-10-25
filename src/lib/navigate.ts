import { useCallback } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import { layoutFor, useData, userLayoutFor } from './data';
import { matchNavCommand, metaFor, serializeLayout, setEnabled, type TabId } from './voice';

/**
 * Where a tab actually lives in the DOM, per audience. The 3D twin is the stage on
 * both screens; the nurse chart folds the record, history, and devices into the
 * chart panel (`labs`).
 */
export function domTargetFor(id: TabId, audience: 'patient' | 'nurse'): string {
  if (id === 'twin') return 'twin-stage';
  if (audience === 'nurse' && (id === 'health-record' || id === 'history' || id === 'devices')) return 'labs';
  return id;
}

/** Tabs that live on their own page instead of inside the dashboard scroll. */
export const PAGE_TABS: ReadonlySet<string> = new Set(['schedule', 'messages', 'setup']);

/**
 * The mounted shell registers a page switcher here. It receives a DOM target
 * (as returned by domTargetFor) and returns true when it changed pages, so the
 * caller can wait for the new page to mount before highlighting.
 */
let pageActivator: ((target: string) => boolean) | null = null;

export function registerPageActivator(fn: ((target: string) => boolean) | null) {
  pageActivator = fn;
}

/** Switch to the page that owns a target when needed, then flash it there. */
export function jumpToTab(target: string, delay = 0) {
  const switched = pageActivator?.(target) ?? false;
  highlightTab(target, switched ? Math.max(delay, 450) : delay);
}

/** Scroll the matching section into view and flash it, so the speaker sees where it lands. */
export function highlightTab(target: string, delay = 0) {
  window.setTimeout(() => {
    const el = document.querySelector(`[data-tab="${target}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('tabflash');
    window.setTimeout(() => el.classList.remove('tabflash'), 1800);
  }, delay);
}

/**
 * Turns "take me to the health tab" into action: reveals the tab when the patient
 * had it hidden, scrolls it into view, and returns the short confirmation line the
 * chat or voice assistant should answer with. Returns null when the message is not
 * a navigation command, so the caller can hand it to the agent instead.
 */
export function useTabNavigator(patientId: bigint, audience: 'patient' | 'nurse') {
  const data = useData();
  const saveLayout = useReducer(reducers.savePatientLayout);
  const saveOwnLayout = useReducer(reducers.saveUserLayout);
  return useCallback(
    (text: string): string | null => {
      const id = matchNavCommand(text);
      if (!id) return null;
      const meta = metaFor(id);
      if (!meta[audience]) return `${meta.label} is only on the ${audience === 'patient' ? "nurse's" : "patient's"} screen.`;

      // Turn the tab on first when the viewer had it hidden, so the command always
      // has somewhere to land; the delayed highlight gives it a moment to mount.
      // The patient view follows the patient's layout; the nurse console follows
      // the nurse's own arrangement.
      let hidden = false;
      if (audience === 'nurse') {
        const own = userLayoutFor(data, data.me?.identity);
        hidden = !own.tabs.find(t => t.id === id)?.on;
        if (hidden) {
          void saveOwnLayout({
            tabs: serializeLayout({ ...own, tabs: setEnabled(own.tabs, id, true) }),
          }).catch(() => {
            // Navigation still works for tabs that were already on screen.
          });
        }
      } else if (patientId) {
        const layout = layoutFor(data, patientId);
        hidden = !layout.tabs.find(t => t.id === id)?.on;
        if (hidden) {
          void saveLayout({
            patientId,
            tabs: serializeLayout({ ...layout, tabs: setEnabled(layout.tabs, id, true) }),
            goal: layout.goal,
            assessed: layout.assessed,
          }).catch(() => {
            // Navigation still works for tabs that were already on screen.
          });
        }
      }
      jumpToTab(domTargetFor(id, audience), hidden ? 450 : 0);
      return hidden ? `Turning on ${meta.label} and taking you there.` : `Taking you to ${meta.label}.`;
    },
    [data, patientId, audience, saveLayout, saveOwnLayout]
  );
}
