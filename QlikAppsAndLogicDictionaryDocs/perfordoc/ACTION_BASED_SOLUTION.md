# Action-Based Solution - No Chart Expression Changes Needed

## Concept

Use **Actions** to update `vScorecard` and `vScorecardActor` variables based on **both** channel selection AND actor selection (`vTopTieringShow`). Charts continue using `[$(vScorecard)]` and `[$(vScorecardActor)]` unchanged.

## How It Works

### Step 1: Channel Selection

- User selects channel(s) (e.g., "Banked - Retail")
- **Channel selection determines which actors are AVAILABLE** in the actor dropdown:
  - Retail channels → Show "Branch" and "Loan Officer"
  - TPO channels → Show "Account Executive" and "Broker Lender Name"
  - Both → Show all four options

### Step 2: Actor Selection Dropdown

- User selects **ONE** actor from the dropdown (e.g., "Branch" or "Loan Officer")
- Dropdown sets `vTopTieringShow`:
  - `vTopTieringShow = 1` → Organization level (Branch or Account Executive)
  - `vTopTieringShow = 0` → Individual level (Loan Officer or Broker Lender Name)

### Step 3: Actions Update Variables

- Actions update `vScorecard` and `vScorecardActor` based on **both** channel selection AND `vTopTieringShow`:
  - If Retail selected AND vTopTieringShow=1 → `vScorecard='Branch'` (charts use this)
  - If Retail selected AND vTopTieringShow=0 → `vScorecardActor='Loan Officer'` (charts use this)
  - If TPO selected AND vTopTieringShow=1 → `vScorecard='Account Executive'` (charts use this)
  - If TPO selected AND vTopTieringShow=0 → `vScorecardActor='Broker Lender Name'` (charts use this)

### Step 4: Charts Display Data

- Charts use `[$(vScorecard)]` when vTopTieringShow=1 (organization level)
- Charts use `[$(vScorecardActor)]` when vTopTieringShow=0 (individual level)
- Charts display data for **ONE selected actor** at a time

## Implementation

### Recommended: Field Filter with Actions (Simplest Approach)

**Step 1: Add Channel Field Filter**

- Add a **filter pane** or **field list** object for the `Channel` field on the TopTiering sheet
- Users can select one or more channels directly from the field

**Step 2: Add Action on Channel Field Selection**

- Create an **Action** that triggers when Channel field selections change
- Action type: **Set Variable**
- Action expression:

```qlik
=If(WildMatch(GetFieldSelections(Channel),'*Retail*','*Brok*'),
    Set vScorecard='Branch'; Set vScorecardActor='Loan Officer',
    If(WildMatch(GetFieldSelections(Channel),'*Wholesale*','*Corresp*'),
        Set vScorecard='Account Executive'; Set vScorecardActor='Broker Lender Name',
        // Default: keep current values if no match
        Set vScorecard='$(vScorecard)'; Set vScorecardActor='$(vScorecardActor)'
    )
)
```

**Step 3: Actor Dropdown Setup**

**Variable Input Object:**

- Variable: `vTopTieringShow`
- **Values Expression** (dynamic based on channel selection):

```qlik
=If(Len(Trim(GetFieldSelections(Channel)))=0 OR GetFieldSelections(Channel)='',
    // No channel selected - show blank
    '',
    If(WildMatch(GetFieldSelections(Channel),'*Retail*','*Brok*') AND NOT WildMatch(GetFieldSelections(Channel),'*Wholesale*','*Corresp*'),
        // Only Retail channels selected
        '1~Branch|0~Loan Officer',
        If(WildMatch(GetFieldSelections(Channel),'*Wholesale*','*Corresp*') AND NOT WildMatch(GetFieldSelections(Channel),'*Retail*','*Brok*'),
            // Only TPO channels selected
            '1~Account Executive|0~Broker Lender Name',
            // Both Retail and TPO channels selected - show all options
            '1~Branch|0~Loan Officer|1~Account Executive|0~Broker Lender Name'
        )
    )
)
```

**Important Notes:**

- When no channel is selected, dropdown will be blank (empty)
- When only Retail channels selected → Shows "Branch" and "Loan Officer"
- When only TPO channels selected → Shows "Account Executive" and "Broker Lender Name"
- When both Retail and TPO channels selected → Shows all four options

### Alternative: Variable Input with Actions

If you prefer a dropdown instead of field filter:

**Step 1: Create Channel Variable Input**

- Create a new variable: `vSelectedChannel` (or use existing variable)
- Variable Input Object:
  - Variable: `vSelectedChannel`
  - Values: `=Concat(DISTINCT Channel,'|')`
  - **Action on Selection**: Set Variable

**Step 2: Action Expression:**

```qlik
=If(WildMatch('$(vSelectedChannel)','*Retail*','*Brok*'),
    Set vScorecard='Branch'; Set vScorecardActor='Loan Officer',
    Set vScorecard='Account Executive'; Set vScorecardActor='Broker Lender Name'
)
```

**Step 3: Actor Dropdown**

- Variable: `vTopTieringShow`
- Values: `1~Organization Level|0~Individual Level`
- Or dynamic: `=If(WildMatch('$(vSelectedChannel)','*Retail*','*Brok*'),'1~Branch|0~Loan Officer','1~Account Executive|0~Broker Lender Name')`

## Benefits

✅ **No chart expression changes needed** - Charts continue using `[$(vScorecard)]`  
✅ **Variables update dynamically** - Actions set variables based on selections  
✅ **Uses existing structure** - Works with current chart logic  
✅ **Simple for users** - Select channel, select actor, charts update automatically

## Limitations

⚠️ **Actions update variables** - Variables change when user makes selections  
⚠️ **Variable state** - Variables persist until changed (not reset on reload)  
⚠️ **Timing** - Actions execute after selection, charts refresh automatically

## Action Setup Instructions - Detailed Step-by-Step

### How to Create the Actions in Qlik Sense

#### Step 1: Open Sheet in Edit Mode

- Go to **TopTiering** sheet
- Click **Edit Sheet** (or press Ctrl+E)

#### Step 2: Add Channel Field Filter

- **Insert** → **Filter pane** (or right-click → Insert → Filter pane)
- Add `Channel` field to the filter pane
- **OR** insert a **Field list** object for `Channel` field
- Position it where you want users to select channels

#### Step 3: Create Sheet-Level Actions

**Important**: Filter panes don't support actions directly. We need to use **sheet-level actions** instead.

1. **Select the Sheet** (not any object)

   - Click on an empty area of the sheet (not on any chart or filter)
   - Make sure nothing is selected (click empty space)

2. **Open Sheet Actions**

   - Go to **Properties** panel (right side)
   - Look for **Sheet actions** tab or **Actions** tab
   - **OR** Right-click on empty area → **Sheet actions**
   - **OR** Go to **Sheet** menu → **Sheet actions**

3. **Configure Action 1: Set vScorecard** (Updates when channel changes)

   - **Action Type**: Select **"Set variable value"**
   - **Variable** field: Enter exactly (as text, not expression): `vScorecard`
   - **Value** field: Click the **fx** button to enable expression mode, then enter:

   ```qlik
   =If(Len(Trim(GetFieldSelections(Channel)))=0 OR GetFieldSelections(Channel)='',
       // No channel selected - keep current value
       '$(vScorecard)',
       If(WildMatch(GetFieldSelections(Channel),'*Retail*','*Brok*'),
           // Retail channels selected
           'Branch',
           If(WildMatch(GetFieldSelections(Channel),'*Wholesale*','*Corresp*'),
               // TPO channels selected
               'Account Executive',
               'Branch'  // Default fallback
           )
       )
   )
   ```

   - Click **OK** or **Apply** to save the action
   - **Note**: This action updates `vScorecard` whenever channel selection changes. Charts use this when `vTopTieringShow=1`.

4. **Configure Action 2: Set vScorecardActor** (Updates when channel changes)
   - Click **Add Action** again → **Set variable value**
   - **Action Type**: Select **"Set variable value"**
   - **Variable** field: Enter exactly (as text, not expression): `vScorecardActor`
   - **Value** field: Click the **fx** button to enable expression mode, then enter:
   ```qlik
   =If(Len(Trim(GetFieldSelections(Channel)))=0 OR GetFieldSelections(Channel)='',
       // No channel selected - keep current value
       '$(vScorecardActor)',
       If(WildMatch(GetFieldSelections(Channel),'*Retail*','*Brok*'),
           // Retail channels selected
           'Loan Officer',
           If(WildMatch(GetFieldSelections(Channel),'*Wholesale*','*Corresp*'),
               // TPO channels selected
               'Broker Lender Name',
               'Loan Officer'  // Default fallback
           )
       )
   )
   ```
   - Click **OK** or **Apply** to save the action
   - **Note**: This action updates `vScorecardActor` whenever channel selection changes. Charts use this when `vTopTieringShow=0`.

#### Step 4: Verify Actions Are Set Up

You should now have **2 sheet-level actions**:

1. Action 1: Sets `vScorecard` based on channel selection (always updates when channel changes)
2. Action 2: Sets `vScorecardActor` based on channel selection (always updates when channel changes)

**How Sheet-Level Actions Work:**

- Sheet-level actions automatically execute when selections change on the sheet
- There may not be a separate "Trigger" option in the action configuration dialog
- The actions will run whenever any field selection changes (including Channel field or actor dropdown)
- Both actions update their respective variables whenever channel selection changes
- Charts use the correct variable based on `vTopTieringShow`:
  - When `vTopTieringShow=1` → Charts use `[$(vScorecard)]` (Branch or Account Executive)
  - When `vTopTieringShow=0` → Charts use `[$(vScorecardActor)]` (Loan Officer or Broker Lender Name)

**Important**:

- **Both actions update whenever channel changes** - this ensures variables are always correct
- Charts automatically use the right variable based on `vTopTieringShow` value
- Charts display data for **ONE selected actor** at a time

**Important Notes:**

- **Variable field**: Enter the variable name as **plain text** (e.g., `vScorecard`), NOT as an expression
- **Value field**: Click the **fx** button to enable expression mode, then enter the expression
- **Two separate actions**: You need one action per variable (Qlik Sense can't set multiple variables in one action)

#### Step 5: Test the Actions

1. **Exit Edit Mode** (click **Done** or press Ctrl+E)
2. **Select a Retail channel** (e.g., "Banked - Retail")
   - Actor dropdown should show "Branch" and "Loan Officer"
3. **Select "Branch"** (vTopTieringShow=1)
   - Check variables: `vScorecard` should = `'Branch'`
   - Charts should show Branch data
4. **Select "Loan Officer"** (vTopTieringShow=0)
   - Check variables: `vScorecardActor` should = `'Loan Officer'`
   - Charts should show Loan Officer data
5. **Select a TPO channel** (e.g., "Banked - Wholesale")
   - Actor dropdown should show "Account Executive" and "Broker Lender Name"
6. **Select "Account Executive"** (vTopTieringShow=1)
   - Check variables: `vScorecard` should = `'Account Executive'`
   - Charts should show Account Executive data
7. **Verify charts update** - Charts should automatically refresh and show data for the selected actor only

### Troubleshooting

**If actions don't trigger:**

- Verify actions are set at the **sheet level** (not on filter objects - they don't support actions)
- Sheet-level actions should automatically trigger on selection changes - there may not be a separate trigger setting
- Check that expressions are valid (no syntax errors)
- Try selecting a different field first, then Channel, to test if actions are working
- If your Qlik Sense version requires triggers, they may be configured elsewhere (check Sheet properties or action properties)

**If actor dropdown shows wrong values:**

- Make sure you're using **"Values expression"** (not static values)
- Verify the expression checks `GetFieldSelections(Channel)` correctly
- Test the expression in the expression editor to see what it returns
- Check if channel selections are being detected (try selecting/deselecting channels)

**If dropdown doesn't show blank when no channel selected:**

- Verify the first condition `GetFieldSelections(Channel)=''` is working
- You may need to use `Len(GetFieldSelections(Channel))=0` instead
- Or use `Only(Channel)` to check if exactly one channel is selected

**If variables don't update:**

- Check variable names are exact: `vScorecard` and `vScorecardActor` (case-sensitive)
- Verify expressions are evaluating correctly (test in expression editor first)
- Make sure you clicked the **fx** button in the Value field to enable expression mode
- Verify Variable field has plain text (no quotes, no = sign)

**If charts don't update:**

- Charts should auto-refresh when variables change
- Verify charts are using `[$(vScorecard)]` and `[$(vScorecardActor)]` in their expressions
- Check if there are any other filters preventing data from showing

## Notes

- **No load script variables needed** - We removed `vTopTieringChannel` since actions can read directly from field selections
- **Sheet-level actions required** - Filter panes don't support actions, so we use sheet-level actions that trigger on any selection change
- **Field filter approach is recommended** - Simpler UI, no variable management needed
- **Charts remain unchanged** - They continue using `[$(vScorecard)]` and `[$(vScorecardActor)]`

## Alternative: Button with Actions

If sheet-level actions don't work or you want more control:

1. **Insert a Button** object

   - **Insert** → **Objects** → **Button**
   - Label it: "Update Actor Variables" or "Apply Channel Selection"

2. **Add Actions to Button**

   - Select the button
   - **Properties** → **Actions** tab → **Add Action**
   - Create the same two actions as above (Set vScorecard and Set vScorecardActor)
   - **Trigger**: "On click"

3. **User Workflow**:
   - User selects channel in filter pane
   - User clicks button to update variables
   - Charts refresh automatically
