# Viana

*A personal space where I decide how I want to spend my time.*

Viana is a single-file web app (`index.html`) for long-term activity management and daily time planning. It has no build step, no server and no dependencies.

## Test it locally
Double-click `index.html` to open it in Chrome, Edge, Firefox or Safari. That's all you need to do.

## Host it on GitHub Pages
1. Create a new repository on GitHub, for example `viana`. It can be public or private (private Pages needs a paid plan).
2. Upload `index.html` and `README.md` to the root of the repository.
3. Go to **Settings → Pages**. Under **Source**, choose **Deploy from a branch**, then select **main** and **/ (root)**, and click **Save**.
4. After a minute or so, the app is live at `https://<your-username>.github.io/viana/`.

To update the app, replace `index.html` in the repository. Your data is not affected, because it lives in your browser and not on GitHub.

## Where your data lives (important)
- Data is saved in the **browser's localStorage on each device**. Nothing is sent anywhere.
- Your laptop and your phone each keep **separate** data. To move data between them, use **Settings → Export backup** and then **Restore from backup**.
- If you clear your browser's site data, your Viana data is erased. **Export a backup regularly.** Settings shows when you last made one.
- The data opened from a local file (`file://`) is separate from the data on the GitHub Pages URL. Once you go live, use only the hosted URL.
- The optional **PIN lock** is a privacy screen for this device only. It does not encrypt your data.

## Daily workflow
1. **Activities**: capture something you generally want to do, along with why it matters (motives), what you get from it (outcomes), effort and priority.
2. **Plan** (tomorrow by default): add tasks from your activities. The activity's defaults pre-fill each task, and you can change anything for that particular day. You can reorder tasks with the arrows or by dragging, and the page shows your total planned time.
3. **Today**: see your plan. Tap **✓ Done** for anything that went as planned, which copies the plan into the actuals.
4. **Review** (end of day): for each task, choose a status and adjust only what was different. Changes save automatically. Use **+ Add unplanned activity** for spontaneous things.
5. Postponed or unfinished items can be carried to another day. The original record stays as it was.

## Data model
The data is stored as relational tables: arrays of rows linked by ids. They are kept in one localStorage key, `viana.db.v1`.

| Table | Key fields |
|---|---|
| `activities` | id, name, description, defaultPriority, defaultTimeMin, defaultMental, defaultResistance, active, createdAt, modifiedAt |
| `activityMotives` | activityId ↔ motiveId (many-to-many) |
| `activityOutcomes` | activityId ↔ outcomeId (many-to-many) |
| `activityHistory` | id, activityId, changeId (groups one save), at, field, oldValue, newValue, note |
| `tasks` | id, activityId, activityNameAtCreation, date, title, order, isUnplanned, status, **plan:** planTimeMin, planMental, planResistance, planPriority, planNotes, **actual:** actTimeMin, actMental, actResistance, actPriority, actSatisfaction, actNotes, carriedFromTaskId, carriedToTaskId, createdAt, modifiedAt, reviewedAt |
| `taskMotives` | taskId ↔ motiveId, kind = `planned` or `actual` |
| `taskOutcomes` | taskId ↔ outcomeId, kind = `planned` or `actual` |
| `motives`, `outcomes` | id, name, description, active, order |
| `settings` | theme, dayCapacityHours, scale labels, pinHash, lastBackupAt |

**Rules that protect historical integrity**
- Each task copies the activity's values when it is created and keeps its own values from then on. Editing an activity never changes past tasks.
- Every change to an activity is logged field by field in `activityHistory`, with old and new values and an optional note.
- Plan and actual values are stored in separate fields and separate link rows, so recording actuals never overwrites the plan.
- Motives and outcomes that have been used can only be deactivated, not deleted. Deactivated items stay visible on the old records that use them.

All times are stored in minutes.

## Analysis later
**Settings → Export tasks (.csv)** gives one row per task with all planned and actual fields, plus motives and outcomes. You can open this file in Excel to look at planned vs. actual time, time by motive or outcome, how often things are postponed, and how satisfied you were relative to the time spent.

## Extending
All code is in `index.html`:
- **Views:** `VIEWS.today`, `VIEWS.plan`, `VIEWS.review`, `VIEWS.activities`, `VIEWS.activity`, `VIEWS.settings`
- **Data helpers:** `byId`, `getLinks` / `setLinks`, `A.*`, `T.*`
- **Click handlers:** `ACTIONS`

If you change the data structure, bump `SCHEMA_VERSION` and add an upgrade step in `migrate()`. That way existing data upgrades automatically.
