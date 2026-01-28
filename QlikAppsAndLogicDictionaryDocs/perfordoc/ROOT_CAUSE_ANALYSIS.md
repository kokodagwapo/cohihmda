# Root Cause Analysis - Action Logic Issue

## Problem

1. Selecting non-retail actors still shows LO/Branch data
2. When ALL channels selected:
   - Select "Loan Officer" → Auto-switches to "Broker Lender Name"
   - Select "Branch" → Auto-switches to "Account Executive"

## Root Cause

**The actions are firing when `vTopTieringShow` changes (actor selection), not just when channel changes.**

When user selects an actor:
1. `vTopTieringShow` changes (e.g., from 1 to 0)
2. Actions fire (because they trigger on "selection change")
3. Actions check channel selection and update variables
4. This OVERRIDES what the user just selected

**Example Flow (ALL channels selected, user selects "Loan Officer"):**
1. User selects "Loan Officer" → `vTopTieringShow` = 0
2. Action fires (triggered by selection change)
3. Action checks: `WildMatch(GetFieldSelections(Channel),'*Banked - Retail*')` = TRUE (all channels selected)
4. Action sets `vScorecardActor='Loan Officer'` ✓
5. BUT then Action also checks: `WildMatch(GetFieldSelections(Channel),'*Wholesale*','*Corresp*')` = TRUE
6. The nested IF might be evaluating incorrectly, OR...
7. **The real issue**: When ALL channels are selected, the expression evaluates to show TPO actors because of the logic flow

Wait, let me re-read the expression:

```qlik
If(WildMatch(GetFieldSelections(Channel),'*Banked - Retail*'),
    'Branch',  // This should execute when Banked - Retail is selected
    If(WildMatch(GetFieldSelections(Channel),'*Wholesale*','*Corresp*'),
        'Account Executive',
        'Branch'
    )
)
```

When ALL channels selected:
- First IF: `WildMatch(GetFieldSelections(Channel),'*Banked - Retail*')` = TRUE
- Returns 'Branch' ✓

But the issue is that the actions are checking channel selection EVERY TIME they fire, including when actor changes. So:

1. User selects "Loan Officer" (vTopTieringShow=0)
2. Action 2 fires
3. Action 2 checks channel → sees "Banked - Retail" selected → sets vScorecardActor='Loan Officer'
4. But then something else is changing it...

OR - the actions shouldn't fire when vTopTieringShow changes. They should ONLY fire when Channel field selection changes.

## Solution

**Actions should ONLY update variables when Channel selection changes, NOT when vTopTieringShow changes.**

But Qlik Sense sheet-level actions fire on ANY selection change. We need to add a condition to check if Channel selection actually changed, or use a different approach.

**Better Solution**: Check if Channel field selection changed by comparing current selection to a stored value, OR use a condition that prevents action from running when only vTopTieringShow changes.

Actually, the simplest fix: Actions should check if Channel field has selections, and if not, don't update. But that's already there.

**Real Fix**: The actions need to be smarter - they should check if the Channel field selection changed, not just fire on any selection change.

But wait - Qlik Sense doesn't have a way to detect which field changed. So we need a different approach.

**Best Solution**: Make actions conditional - only update if Channel field has a selection AND the values make sense. But also, we need to ensure actions don't override user's actor selection.

Actually, I think the real issue is simpler: When ALL channels are selected, the dropdown shows all 4 options. User selects one. But the actions are checking channel selection and might be setting the wrong variable.

Let me think about this differently:
- When ALL channels selected, dropdown shows: Branch, Loan Officer, Account Executive, Broker Lender Name
- User selects "Loan Officer" → vTopTieringShow=0
- Charts should use vScorecardActor
- Action 2 should have already set vScorecardActor='Loan Officer' when channel was selected
- But if actions fire again when actor changes, they might be resetting it

The fix: Actions should NOT fire when vTopTieringShow changes. But we can't control that with sheet-level actions.

**Alternative Fix**: Make the action expressions smarter - check if we're in a state where we should update, or use a flag variable.

Actually, the simplest fix: The actions should check the CURRENT value of vTopTieringShow and only update the appropriate variable. But that's what we have...

Wait, I see it now! When ALL channels are selected:
- Action 1 checks: Banked - Retail selected? YES → Sets vScorecard='Branch'
- Action 2 checks: Banked - Retail selected? YES → Sets vScorecardActor='Loan Officer'

But then when user selects "Account Executive" (vTopTieringShow=1):
- Action 1 fires again
- Checks channel → Banked - Retail selected? YES → Sets vScorecard='Branch' (wrong! should be Account Executive)

The problem: The actions are setting variables based ONLY on channel, not considering that when ALL channels are selected, the user should be able to choose ANY actor.

**Solution**: When ALL channels are selected (both Retail and TPO), actions should NOT override the variables. Or, actions should set variables based on what the user selected in the dropdown, not just channel.

But we can't do that with actions - actions can't read vTopTieringShow value to determine which variable to update.

**Correct Solution**: 
1. Actions should update BOTH variables when channel changes
2. When ALL channels selected, set both variables to the first option (Branch/Loan Officer) as default
3. When user selects actor, charts use the correct variable (vScorecard or vScorecardActor)
4. Actions should NOT fire when only vTopTieringShow changes

But we can't prevent actions from firing...

**Final Solution**: Make actions conditional - only update variables if Channel field selection changed. We can do this by checking if the current variable value matches what we would set it to. If it matches, don't change it. But that's not reliable.

**Better Final Solution**: 
- When channel selection changes, actions update BOTH variables correctly
- When ALL channels selected, actions set: vScorecard='Branch', vScorecardActor='Loan Officer' (defaults)
- When user selects different actor, vTopTieringShow changes
- Charts use the correct variable based on vTopTieringShow
- Actions should NOT fire again when vTopTieringShow changes

But they do fire... So we need to make actions idempotent - if they run again with same channel selection, they should set same values.

Actually, wait - the real issue might be that when ALL channels selected, the expression logic is wrong. Let me check the expression again:

```qlik
If(WildMatch(GetFieldSelections(Channel),'*Banked - Retail*'),
    'Branch',  // Executes when Banked - Retail is in selection
    If(WildMatch(GetFieldSelections(Channel),'*Wholesale*','*Corresp*'),
        'Account Executive',
        'Branch'
    )
)
```

When ALL channels selected:
- GetFieldSelections(Channel) = "Banked - Retail|Banked - Wholesale|Brokered|Correspondent|99-Missing" (or similar)
- WildMatch(...,'*Banked - Retail*') = TRUE
- Returns 'Branch' ✓

So that should work. But maybe the issue is that actions are running in wrong order, or there's a timing issue.

**I think the real issue**: When user selects "Account Executive" from dropdown (vTopTieringShow=1), Action 1 fires and sets vScorecard='Branch' (because Banked - Retail is selected). But the user wants Account Executive.

The solution: When ALL channels are selected, we need to set variables based on what the user selected in the dropdown, not just channel. But actions can't do that.

**Actual Solution**: We need to change the approach. Instead of actions setting variables based on channel, actions should set variables based on BOTH channel AND the selected actor value. But we can't read the actor value in actions...

**Final Real Solution**: 
- Remove the channel check from actions
- Actions should set variables based on a combination of channel AND vTopTieringShow
- When vTopTieringShow=1 and Retail selected → vScorecard='Branch'
- When vTopTieringShow=1 and TPO selected → vScorecard='Account Executive'
- When vTopTieringShow=0 and Retail selected → vScorecardActor='Loan Officer'
- When vTopTieringShow=0 and TPO selected → vScorecardActor='Broker Lender Name'

But when ALL channels selected, which one? We need to check vTopTieringShow to see what the user selected.

Actually, I think the solution is simpler: When ALL channels are selected, the actions should set variables based on vTopTieringShow value. If vTopTieringShow=1, set vScorecard based on... wait, we still need to know which channel.

**I think I finally see it**: The actions need to check BOTH channel AND vTopTieringShow, and when ALL channels are selected, they should prioritize based on vTopTieringShow or use a default.

Let me write the correct expressions:
