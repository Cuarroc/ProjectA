I'll review the final candidate against the live source, not just the diff, and check the earlier fixes for real correctness bugs.The 5-second refresh drops focus from every button in the goals card, and assignment drafts are detected against defaults that were never set to the server values. Stage A’s four fixes are present and behave as described; the findings below are new.

### High — focused buttons are blurred on every refresh, including an unchanged tick

`refresh()` disables every button before it waits on the network, and it only remembers focus when it later rebuilds:

```149:149:docs/dev-hq/continuous.js
      online = false; enable(false);
```

```60:61:docs/dev-hq/continuous.js
    function enable(available) {
      card.querySelectorAll('button').forEach(button => { button.disabled = !available || busy || button.dataset.locked === 'true'; });
```

```177:178:docs/dev-hq/continuous.js
        const rebuildGoals = signature !== lastSignature;
        const saved = rebuildGoals ? captureListState() : null;
```

```119:122:docs/dev-hq/continuous.js
      if (active && list.contains(active)) {
        const host = active.closest('details[data-task-id]');
        const part = active.name || (active.tagName === 'BUTTON' ? 'submit' : active.tagName.toLowerCase());
        focus = { taskId: host?.dataset.taskId || null, part };
```

The live page calls this on the 5-second timer (`docs/dev-hq/hq.js` 944 and 1230). In Chrome and Firefox, disabling the focused control blurs it immediately. By the time `captureListState()` runs, `document.activeElement` is the document body, so the submit button is never recorded. On an unchanged signature the DOM is kept and nothing restores focus after `enable(true)` at line 291. On a changed signature the restore path at lines 140–143 and 262–266 only refocuses what was captured, which is no longer the button.

Named inputs and `<summary>` stay focused, because `enable()` does not disable them. The assignment submit, “Ziel speichern”, “Arbeitspaket speichern”, and the pause/drain/resume/cancel buttons do not. The create-form and control buttons also sit outside `[data-goals]` (lines 16–38 versus `list` at line 49), so they are outside the capture set even if capture ran before the disable.

`scripts/lib/hq-goals-live.test.mjs` 89–112 focuses the submit button and expects it back after `refresh()`. jsdom does not blur a button when `disabled` is set, and that test never runs in a browser. The browser check in `hq-visual.browser.mjs` only covers the ownership text and the `g` key.

### Medium — untouched fields are saved as drafts, and a cleared assignee is not

Dirty detection compares against `defaultValue` / `defaultSelected`:

```109:114:docs/dev-hq/continuous.js
        const assignee = form.elements.assignee;
        if (assignee && assignee.value !== assignee.defaultValue) draft.assignee = assignee.value;
        for (const name of ['teamId', 'role']) {
          const field = form.elements[name];
          if (field && [...field.options].some(option => option.selected !== option.defaultSelected)) draft[name] = field.value;
        }
```

The controls are filled by setting `.value` and by appending options with no `selected` attribute (lines 231–244). That updates the current value only. `defaultValue` stays `""`, and `defaultSelected` stays false. Two failures follow on the next rebuild, which any other task’s `attempts`, status, or claim will trigger because the signature covers every task:

- Clearing a prefilled assignee makes `value === defaultValue === ""`, so the edit is dropped and line 244 writes the server assignee back.
- An untouched prefilled assignee, team, and role are always stored. If the server assignment then changes, lines 133–136 paint the previous values over the new form. Lines 262–266 store the new signature, so later identical polls do not rebuild, and the stale seat stays. The ownership line was already rendered from the new payload (line 183), so the summary and the form disagree. The submit handler closes over the new `revision` (lines 245–252) while the fields still show the old seat, so “Zuweisung aktualisieren” writes the old seat back as a new revision.

The unchanged-data test (lines 77–86) never rebuilds, so it does not exercise this.

### Medium — a restored team keeps the previous role list

`fillRoles` runs on the `change` event only (lines 237–243). Restore assigns `teamId` and `role` with `.value` (lines 133–136), which does not fire `change`. After the operator switches team and a rebuild happens, the team select shows the draft team and the role select still lists the previous team’s roles. The draft role is then applied to that old list: if it is absent, the control falls back to the first old role. Submit sends the new team with the old team’s role.
