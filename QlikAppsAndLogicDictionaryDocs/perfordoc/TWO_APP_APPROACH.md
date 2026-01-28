# Two-App Approach Analysis

## Overview

Instead of one app handling both Retail and TPO channels dynamically, create **two separate apps**:
- **Performance - Retail**: `SET vConsolidatedChannels = 'Retail';`
- **Performance - TPO**: `SET vConsolidatedChannels = 'TPO';`

---

## Pros of Two-App Approach

### ✅ **Much Simpler Architecture**

**No Dynamic Logic Needed:**
- No show conditions on charts
- No action-based variable updates
- No complex `if(Match(...))` expressions in charts
- Charts use simple `='$(vScorecard)'` or `='$(vScorecardActor)'` expressions

**Retail App:**
- `vScorecard` = 'Branch' (always)
- `vScorecardActor` = 'Loan Officer' (always)
- Charts always show Branch/Loan Officer data
- No channel selection dropdown needed

**TPO App:**
- `vScorecard` = 'Account Executive' (always)
- `vScorecardActor` = 'Broker Lender Name' (always)
- Charts always show Account Executive/Broker Lender Name data
- No channel selection dropdown needed

### ✅ **Easier to Maintain**

- Each app has fixed, simple logic
- No conditional expressions to debug
- Clear separation of concerns
- Easier for new developers to understand

### ✅ **Better Performance**

- Each app only loads data for its channel type
- Smaller data models
- Faster reloads
- No overhead from dynamic logic

### ✅ **Simpler User Experience**

- Users know which app to use based on their role
- No confusion about channel/actor selection
- Clear, focused dashboards

---

## Cons of Two-App Approach

### ❌ **Two Apps to Maintain**

- Code duplication (but can share common scripts)
- Two apps to update when making changes
- Need to ensure consistency between apps

**Mitigation:** Use shared script files/libraries where possible

### ❌ **No Cross-Channel Comparison**

- Can't easily compare Retail vs TPO in same view
- Users need to switch apps to see different channels

**Mitigation:** If needed, create a third "Comparison" app that loads both

### ❌ **User Confusion**

- Users need to know which app to use
- Might open wrong app initially

**Mitigation:** Clear naming and documentation

---

## Implementation

### Retail App Setup

**`START HERE.qvs`:**
```qlik
SET vConsolidatedChannels = 'Retail';
```

**`Variables.qvs` (Retail block):**
```qlik
IF '$(vConsolidatedChannels)' = 'Retail' THEN

SET vScorecard='Branch';
SET vScorecardActor='Loan Officer';
SET vScorecardList='Branch|Investor';
SET vScorecardActorList='Loan Officer|Underwriter';

END IF
```

**Charts:**
- Dimension: `='$(vScorecard)'` → Always 'Branch'
- Dimension: `='$(vScorecardActor)'` → Always 'Loan Officer'
- No show conditions needed
- No actions needed

### TPO App Setup

**`START HERE.qvs`:**
```qlik
SET vConsolidatedChannels = 'TPO';
```

**`Variables.qvs` (TPO block):**
```qlik
IF '$(vConsolidatedChannels)' = 'TPO' THEN

SET vScorecard='Account Executive';
SET vScorecardActor='Broker Lender Name';
SET vScorecardList='Account Executive|Investor';
SET vScorecardActorList='Broker Lender Name|Account Executive|Underwriter';

END IF
```

**Charts:**
- Dimension: `='$(vScorecard)'` → Always 'Account Executive'
- Dimension: `='$(vScorecardActor)'` → Always 'Broker Lender Name'
- No show conditions needed
- No actions needed

---

## Migration Path

1. **Create TPO App** (copy Retail app)
2. **Update `START HERE.qvs`** in TPO app: `SET vConsolidatedChannels = 'TPO';`
3. **Update `Variables.qvs`** in TPO app: Use TPO variable block
4. **Remove all dynamic logic** from both apps:
   - Remove channel filter dropdowns
   - Remove actor selection dropdowns
   - Remove show conditions
   - Remove sheet actions
   - Simplify chart expressions
5. **Test both apps** independently

---

## Comparison: Current vs Two-App Approach

| Aspect | Current (Single App) | Two-App Approach |
|--------|---------------------|------------------|
| **Complexity** | High (dynamic logic, show conditions, actions) | Low (fixed logic) |
| **Maintenance** | Hard (many moving parts) | Easy (simple, clear) |
| **Charts** | Complex expressions with `if(Match(...))` | Simple `='$(vScorecard)'` |
| **Show Conditions** | Required (multiple charts per container) | Not needed |
| **Actions** | Required (channel/actor selection) | Not needed |
| **User Experience** | Confusing (need to select channels/actors) | Clear (know which app to use) |
| **Performance** | Slower (loads all channels, dynamic logic) | Faster (loads only needed channels) |
| **Code Duplication** | None | Some (but manageable) |

---

## Recommendation

**YES, two-app approach is MUCH simpler and more maintainable!**

Given all the issues we've encountered:
- Show conditions not working correctly
- Actions not firing on variable changes
- Complex chart expressions
- User confusion about channel/actor selection

The two-app approach eliminates ALL of these problems:
- ✅ No show conditions needed
- ✅ No actions needed
- ✅ Simple chart expressions
- ✅ Clear, focused apps
- ✅ Better performance

**The only real downside is maintaining two apps, but that's much easier than maintaining complex dynamic logic in one app.**

---

## Next Steps

1. **Decide if cross-channel comparison is needed**
   - If yes: Keep single app OR create third comparison app
   - If no: Proceed with two-app approach

2. **If proceeding with two apps:**
   - Create TPO app (copy Retail app)
   - Update `START HERE.qvs` in each app
   - Update `Variables.qvs` in each app
   - Remove all dynamic logic
   - Simplify charts
   - Test both apps

3. **Consider shared script library** for common code to reduce duplication
