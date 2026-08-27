# Vinny's Anticheat — Code Review, Fixes & Recommendations

Review of `scripts/main.js` (behavior pack, `@minecraft/server` 2.4.0).

## Piston container dupe protection (new)

Covers the "piston dupe" (a piston pushing a container block-entity duplicates
it — a known Bedrock 1.21 glitch). Covered block-entities: **all shulker boxes,
chests, trapped chests, and barrels**. The pack's existing shulker blocking only
scanned hoppers/dispensers/droppers/crafters, so this path was uncovered.

The glitch has **many geometric variants** — the container straight in front of
the piston, a block (e.g. a lightning rod) pushed *into* the container, or the
container offset by a block from the piston or the pushed block. Matching one
shape is not enough (each offset becomes a bypass), so detection is two-layered:

1. **Placement (`playerPlaceBlock`)** — the obvious "piston aimed straight at a
   container" is caught the instant it's built, attributed to the placer
   (`Piston Dupe: <container>`) and fed into the escalation system.
2. **Continuous sweep** — every piston near a player is checked each scan. Reading
   the piston's facing turned out to be unreliable across versions, so the sweep
   uses **position, not direction**: a shulker touching the piston on any side
   pops it (a shulker next to a piston is virtually never a legit build). It also
   traces the push line as a bonus, so a container behind a pushed block (e.g. a
   lightning rod) or a chest/barrel in the push path is caught. The sweep can't
   reliably identify the builder, so it only removes + alerts; escalation comes
   from the placement path.

Why not the piston push itself: there is no cancellable piston event, and during
a push Bedrock swaps the moving block to `minecraft:moving_block`, so
`pistonActivate.getAttachedBlocks()` can't read the real type — that approach was
removed as unreliable.

Facing is read from the piston's block state, trying both the legacy integer
`facing_direction` and the newer string `minecraft:facing_direction`. If a
version won't expose either, the sweep falls back to popping a piston with a
container directly adjacent, so protection never silently stops working. Both
`minecraft:piston` and `minecraft:sticky_piston` are handled identically.

Deliberately conservative: we only ever remove the **piston**, never the
container or its contents — so a false positive costs at most one piston, never
any items. Chests/barrels only trip the check when actually in a piston's push
line (not mere adjacency), so normal chest-next-to-piston redstone is unaffected;
shulkers are treated more aggressively (adjacency counts), since a shulker next
to a piston is almost never legitimate. Toggle with `/cheats:piston` or in the
panel (default on).

### Duped-item cleanup (geometry-independent safety net)

Because piston-facing can't be read reliably on every version, a second layer
catches the dupe by its *result* instead of its setup: when a piston dupe fires
it drops the extra container as an item entity. On `entitySpawn`, if two or more
of the **same** container item appear at the same block position **next to a
piston** within ~1 second, the extras are deleted (one is kept). It's scoped to
piston-adjacent drops, so ordinary shulker drops from breaking/dropping are never
touched, and it only removes the surplus copies — the player keeps the original.
This is what actually "gets rid of the duped shulker" regardless of the setup
geometry. (It catches dupes that drop items; a variant that duplicates a placed
block instead would need separate handling.)

## Admin-tag gate on the `/cheats:ui` panel (fixed)

`/cheats:ui` was open to any **operator**, so an opped player without the `admin`
tag could open the panel and change settings. It now requires the `admin` tag
(like the log/whitelist commands); non-admin operators get "No permission."
Also, `checkEscalation` now exempts `admin`-tagged players entirely, so an admin
testing detections can never auto-flag or auto-kick themselves.

## Nether portal item dupe protection (new)

Covers the "throw a shulker into a nether portal, wait, force-quit, rejoin"
dupe: the tossed item transfers to the nether while the force-quit rolls the
inventory back to still holding it, leaving two copies. The force-quit can't be
observed by a script, so the vector is denied instead — a **container item
(shulker / chest / trapped chest / barrel) sitting in a nether portal block is
removed** before it can transfer, so the nether copy never exists. A short scan
(`minecraft:portal` block under `minecraft:item` entities near players) runs every
5 ticks. Container items are essentially never tossed through portals in normal
play (you carry them), so collateral is minimal. Toggle `/cheats:portal` or in
the panel (default on). Scoped to containers; can be broadened to more item types
if the dupe is seen abused with them.

## Inventory Sync false positives on fast pickups (fixed)

Players reported "tried to sync duplicated \<item\>" firing when they picked
items up quickly during normal play. Two things combined to cause it:

1. `savePlayerInventory` deliberately **delayed recording any inventory
   increase by ~1 second** (a "pending" debounce). During that window the saved
   baseline still held the *old, lower* counts.
2. `runSpawnCheck` ran on **every** `playerSpawn` — including death-respawns,
   not just rejoins — and deleted anything where the current count exceeded the
   saved baseline.

So a legit pickup that hadn't been committed yet (or any death-respawn shortly
after gaining items) looked like surplus and got removed.

**Fix:**
- The snapshot is now written **immediately and undebounced** — the baseline
  always matches the real online inventory, so freshly picked-up items are never
  "unaccounted for." (Save interval relaxed from every 5 ticks to every 20,
  since a once-per-second pre-disconnect snapshot is plenty and it cuts dynamic-
  property writes.)
- The dupe check now runs **only on an actual join/rejoin** (`initialSpawn`),
  never on death-respawns or normal play. The inventory-sync exploit can only
  add items while a player is *offline*, so rejoin is the only meaningful moment
  to compare — which is exactly when the check now fires.

Removed the now-unused `pendingUpdates` / `lastCommittedCounts` maps and their
`playerLeave` cleanup.

### Teleport / chunk-reload hardening

Teleporting (e.g. via a TP mod) reloads the player entity and surrounding
chunks; during that window the inventory can briefly read **empty or partial**.
If that transient read were saved as the baseline, the player's real items would
look like a surplus "dupe" and be removed. Guards added:

- `savePlayerInventory` now refuses to overwrite a good snapshot with a
  suspicious shrink — an empty read over a non-empty baseline, or a >50% drop,
  is skipped. Rationale: a stale-but-**higher** baseline is safe (it can only
  ever miss a dupe, never invent one); a too-**low** baseline is what fabricates
  false positives. It also bails if the inventory component isn't available yet.
- `runSpawnCheck` skips entirely when the saved baseline is empty/untrusted.

## Inventory Sync: item-removal toggle (new)

Inventory Sync can now run in **alert-only** mode. A new toggle
(`cheats:inventorySyncRemove`, default on) controls whether a detected sync dupe
actually deletes the surplus items or just alerts + logs it. Off = detect and
record but never remove items — safest given the feature's false-positive rate.
Toggle in the panel ("Inv Sync: Remove Items"), via `/cheats:invremove`, and the
mode is shown in `/cheats:status`.

## Inventory Sync excluded from auto-escalation (new)

Inventory Sync is the least reliable detector, so it must never get a player
auto-flagged/kicked/banned. Escalation now uses its own per-player counter
(`cheats:escalationCounts`) that only "confident" detections increment;
`recordDupeAttempt(player, escalatable)` takes a flag, and the Inventory Sync
path passes `false`. Inventory Sync attempts are still counted in the visible
dupe log and history (so admins can review and act manually), but they neither
trigger escalation nor inflate the count that other detections escalate on. The
escalation counter is cleared alongside the log.

## Admin QoL tools (new)

- **`/cheats:admin add/remove/list`** — grant/revoke the `admin` tag from inside
  the pack instead of `/tag`. Operator-gated (`GameDirectors`) so it can bootstrap
  the first admin. Works on online players.
- **Teleport to last offense** — every recorded dupe attempt now stores the
  player's location (`cheats:lastOffense`). `/cheats:tp <player>` warps an admin
  there (cross-dimension aware), and the **Player History** panel screen gets a
  "Teleport to last offense" button. Cleared alongside the log.

## Player freeze (new)

Admins can freeze a player in place for questioning: `/cheats:freeze <player>`,
`/cheats:unfreeze <player>`, `/cheats:frozen` to list, plus a **Freeze Players**
screen in `/cheats:ui` (freeze/unfreeze by dropdown).

A frozen player cannot move, cannot turn their head/camera, and cannot use items,
break/place blocks, or interact with anything — item use is blocked specifically
so an ender pearl or chorus fruit can't break the freeze.

Built on the stable input-permission API (`InputPermissionCategory.Movement` and
`Camera` via `player.inputPermissions.setPermissionCategory`), which is cleaner
than per-tick teleporting. A position anchor still runs every 10 ticks as backup:
if something external (knockback, pistons, flowing water) shifts them more than a
block, they're pulled back. An action-bar reminder shows while frozen.

Frozen state persists across rejoins (`cheats:frozen`) and is re-applied on join.
Because input permissions can persist on a player, any player who is *not* on the
frozen list has movement/camera explicitly re-enabled on join — so nobody can end
up permanently stuck if the pack is reloaded or removed mid-freeze. Admins cannot
be frozen.

## Ban loop from leftover illegal items (fixed)

A player banned for an illegal item (e.g. spawn eggs) could be re-banned the
instant their ban expired, because the item was still in their inventory on
rejoin — an inescapable loop. Two causes, both fixed:

1. **Punishing mid-sweep.** `scanPlayerForIllegalItems` removed one slot, then
   immediately recorded the attempt — which could ban and kick the player *inside*
   the loop, leaving illegal items in every later slot untouched. The sweep is now
   split: `purgeIllegalItems` strips the whole inventory in one pass, and the
   attempt is recorded once afterwards, so the inventory is always fully clean
   before any punishment fires.
2. **Kick/save race.** The kick ran in the same tick as the item removal, so the
   removal could fail to persist to the player's saved data. The auto-ban kick is
   now delayed ~1s so inventory writes land first.

As a belt-and-braces guarantee, illegal items are also **silently purged on join**
(with an admin notice, but deliberately *not* counted as an offense) and a short
join grace stops the live scan from punishing those same leftovers. That
definitively breaks the loop: a returning player always starts clean, while
anything they obtain after joining is punished normally.

## First-offense warning + minecart excluded from auto-ban (new)

- With auto-ban on, a player's **first** confident dupe is now a one-time public
  warning broadcast to everyone ("<name>, I see that you have tried to dupe. Do it
  again and see what happens.") instead of an immediate ban. Every offense after
  that bans at the next tier (2nd → tier 1, 3rd → tier 2, …). The warned state
  (`cheats:warned`) resets when the player's log is cleared.
- The heuristic **"suspected minecart chest dupe"** detection is now log-only for
  auto-ban (like Inventory Sync), since it's the most speculative check — it won't
  warn or ban, only alert + log.

## Simplified escalation: single Auto-ban toggle (new)

The "Auto-flag threshold" slider and "Action at threshold" dropdown were removed
from the panel — the ban tiers already encode the escalation. They're replaced by
one toggle, **Auto-ban repeat dupers** (`cheats:autoBan`, also `/cheats:autoban`).
When on, each confident dupe incident bans the player at their next ban tier (1st
offense → tier 1, 2nd → tier 2, …); an `isBanned` guard stops one incident from
skipping tiers. Inventory Sync is still excluded. The old flag/kick tiers and the
attempt-threshold counter are gone; migration turns the toggle on if the previous
config was threshold>0 with the Ban action. `/cheats:status` shows the toggle and,
when on, the ban tiers.

## Custom ban tiers, up to 10 offenses (new)

The two fixed tiers were replaced by an **editable list of up to 10 per-offense
ban lengths** (`cheats:banTiers`, days; 0 = permanent). The last tier also
applies to every offense beyond it. Default `[1, 3, permanent]` (migrates any
legacy tier values). In the panel, **Bans → Ban Durations** now lets you edit any
tier's days, **add** a tier (up to 10), or **remove** the last one — so you can
set, e.g., attempt 4 = 7 days, attempt 5 = 30 days, etc. `banForStrike` clamps
strikes beyond the list to the last tier. `/cheats:status` and the Bans screen
show the full tier summary.

## Escalating temp-bans with configurable durations (new)

Auto-bans now escalate per repeat offense instead of always being permanent:
1st auto-ban = tier-1 days, 2nd = tier-2 days, 3rd+ = permanent (until an admin
unbans). Defaults: **1 day / 3 days / permanent**. Both tier durations are
adjustable in the panel (Bans → **Ban Durations**), so e.g. the 2nd offense can
be set to 5 days.

- Bans are now stored as `{ name: untilMs }` (0 = permanent, else an expiry
  timestamp); the old array format migrates to permanent. Expired temp-bans are
  lifted automatically on join and pruned when the ban list is viewed.
- A per-player strike count (`cheats:banStrikes`) drives the tier; it resets when
  that player's log is cleared (fresh slate), not on unban.
- `/cheats:banlist` shows remaining time per player; the panel unban dropdown does
  too. `/cheats:ban <player> [days]` supports an optional duration (permanent if
  omitted); the panel "Ban a Player" has a days slider.
- `/cheats:status` shows the ban tiers when the escalation action is Ban.

## Ban tier for auto-escalation (new)

The escalation action is now three tiers instead of a kick on/off toggle:
**Flag only / Kick / Ban** (chosen via the "Action at threshold" dropdown in the
panel, shown in `/cheats:status`). Bedrock has no native `/ban`, so a ban adds
the player to a persistent ban list (`cheats:bannedPlayers`) and kicks them; on
every future join a banned player is kicked as they spawn. Admins are never
auto-banned/kicked, and are also protected from manual bans.

Ban management (admin tag): `/cheats:banlist`, `/cheats:ban <player>`,
`/cheats:unban <player>`, plus a **Bans** screen in `/cheats:ui` (view + unban
via dropdown, or ban by name). The old boolean kick setting is migrated
automatically (kick-on → Kick tier).

## Admin-only alerts & auto-escalation (new)

**Admin-only alerts.** `broadcastAlert` no longer always uses `world.sendMessage`.
When the "Admin-Only Alerts" setting is on, alerts (including the coordinates
they contain) are sent only to players with the `admin` tag, so exploiters and
bystanders aren't tipped off. Toggle it in the panel or with `/cheats:alerts`.
Defaults to off (public) to preserve the original behaviour.

**Auto-escalation.** The `dupe_log` attempt counter now drives enforcement.
Set a threshold (panel slider, or `/cheats:escalate <n>`, `0` = off). When a
player's attempt count reaches the threshold they are tagged `cheats:flagged`
and admins get a one-time ESCALATION notice; if "Kick at threshold" is enabled
they are also kicked (via an operator-level `kick` command). The flag tag stops
it re-firing on every later attempt, and clearing that player's log (or the
whole log) removes the flag so they get a clean slate. Admins can select
players tagged `cheats:flagged` for follow-up.

## `/cheats:ui` control panel (new)

Typing `/cheats:ui` now opens an on-screen form-based control panel (built on
`@minecraft/server-ui`) that consolidates every existing control in one place:

- **Protection Toggles** — a single screen with a switch for all six settings,
  pre-filled with their current state; submit applies them all at once.
- **Dupe Log** — browse logged players; select one to view their history.
- **Player History** — look up any player by name.
- **Clear Log** — clear everything (with a confirm prompt) or a single player.
- **Whitelist** — view / add by ID / add item in hand / remove via dropdown.

The panel opens at operator (`GameDirectors`) level, matching the toggle
commands; the log/history/clear/whitelist sections only appear for players with
the `admin` tag. The original text commands are all still registered and work
unchanged — the UI is additive.

**Two version-sensitive spots to verify in-game** (they depend on your exact
Minecraft version and are the only things I can't test without the game):
1. `manifest.json` declares `@minecraft/server-ui` version `2.1.0`. If the pack
   fails to load with a module/dependency error, change this to the server-ui
   version your Minecraft build ships (e.g. `2.0.0`) — match whatever your other
   working script packs use.
2. The form widgets use the newer options-object signature this build requires
   (`.toggle(label, { defaultValue })`, `.dropdown(label, options,
   { defaultValueIndex })`). `.textField(label, placeholder)` keeps its
   positional placeholder. If you ever downgrade to an older Minecraft build
   that rejects the options object, switch these back to positional values.

## Bugs / problems fixed in this pass

### 1. Ender chests were matched by the illegal-item container scanner
The old container scan matched types with a loose substring test:
`ILLEGAL_ITEM_CONTAINER_TYPES.some(t => block.typeId.includes("chest"))`.
`"minecraft:ender_chest".includes("chest")` is `true`, so ender chests were
pulled into the sweep. Ender chest inventories are per-player and are not
exposed through the block `inventory` component, so nothing broke visibly, but
it was wasted work and a latent correctness trap. Matching is now done with
explicit predicates (`isIllegalScanContainer` / `isBundleScanContainer`) that
keep colored-shulker coverage (`endsWith("shulker_box")`) while **explicitly
excluding `minecraft:ender_chest`**.

### 2. Two full O(radius³) block sweeps ran independently — merged into one
Previously `scanContainersNearPlayers` (every 10 ticks) and
`scanContainersForIllegalItems` (every 20 ticks) each did a separate
`13×13×13 = 2197`-block cube sweep **per player**. That is the single biggest
performance liability on a populated server. They are now a single
`scanNearbyContainers()` sweep that fetches each nearby block **once** and runs
both the bundle-blocking and illegal-item checks on it (respecting each toggle
and the admin bypass). This roughly cuts `getBlock` calls by a third and keeps
detection coverage the same or better.

### 3. In-memory maps for inventory sync grew unbounded
`lastCommittedCounts` and `pendingUpdates` were keyed by player id and never
cleaned up. Added a `world.afterEvents.playerLeave` handler that drops those
runtime cache entries when a player leaves.
Note: the **persisted** `dp_inv_<id>` dynamic property is intentionally *kept*
on leave — the relog dupe check needs that baseline to compare against on
rejoin. See recommendation #4 for capping that persisted data.

### 4. Minor correctness / cleanup
- `clearDupeLogEntry` no longer calls `setScore(name, 0)` right before removing
  the participant. Setting the score re-creates the participant, so the old
  code left a `0` entry behind if the remove-by-`displayName` loop didn't match.
  It now removes the participant directly.
- `runSpawnCheck` used `player.getComponent("inventory").container` with no
  null guard (only saved by the outer try/catch). Now uses optional chaining
  and returns early if the container is missing.
- Removed the dead `?? block.getComponent("crafting")` fallback — `"crafting"`
  is not a valid block component id and the crafter is handled by the
  `playerInteractWithBlock` event instead.
- Dropped the non-standard `cheatsRequired: false` property from every command
  definition (not part of the custom-command schema; it was silently ignored).
- Bumped pack version to `1.3.58` in `manifest.json`.

## Known limitations that were left as-is (by design, but worth knowing)

- **Bundle/shulker blocking deletes the item.** Any bundle or shulker box that
  lands in a hopper/dispenser/dropper/crafter is *destroyed*, not just blocked.
  A legitimate player using a hopper to sort shulker boxes will lose them. This
  is aggressive but matches the pack's stated "block the transaction" intent.
- **Nearby-container detection attributes items to the closest player.** The
  illegal-container and minecart-dupe alerts blame whichever non-admin player
  is within range, which can flag innocent bystanders.
- **Inventory-sync detection is heuristic.** It compares your inventory on
  rejoin against the last snapshot taken while you were online and removes any
  surplus. It ships **disabled by default** (`getInventorySyncSetting()`
  defaults to `false`). See the fix below for the false-positive cause.

---

## Recommendations to add / improve

> ✅ Admin-only alert routing and auto-escalation for repeat offenders are now
> implemented — see the sections near the top of this file.

1. **Move from polling to event-driven detection where possible.** The cube
   sweeps run every 10–20 ticks regardless of whether anything changed. Hooking
   `playerInteractWithBlock` / container-open events and scanning only the
   container that was actually touched would remove almost all of the per-tick
   cost. Keep a cheap low-frequency sweep as a backstop.

2. **Stagger scans across players / add a per-tick block budget.** If you keep
   polling, process a subset of players per tick (round-robin) or cap the number
   of `getBlock` calls per tick so a full server doesn't spike the tick time.

3. **Add a configurable illegal-items / banned-blocks list via commands**
   instead of the hard-coded `Set`s, and persist it to a dynamic property like
   the whitelist. Admins could then ban modded/NBT items without editing the
   script.

4. **Cap or prune the persisted `dp_inv_<id>` data.** World dynamic properties
   share a byte budget; one JSON inventory map per player who ever joined will
   grow forever. Consider pruning entries older than N days on join, or storing
   the inventory hash instead of the full map.

5. **Elytra/enchantment/NBT sanity checks.** Detect impossible enchantment
   levels, illegal enchantment combinations, or items with unobtainable
   durability/lore — a very common survival-server dupe/hacked-item vector.

6. **Rate-based movement / reach checks** (fly, speed, nuker, long-reach block
   breaking) if you want this to grow beyond a dupe guard into a general
   anticheat. These are best done with per-player velocity/position sampling.

7. **Alert routing.** `broadcastAlert` currently messages *everyone*, which
   leaks dupe coordinates to all players (including the cheater and their
   friends). Consider sending alerts only to players with the `admin` tag, and
   optionally logging to a webhook/log objective for review.

8. **Cooldown / escalation.** Track repeat offenders (the `dupe_log` scoreboard
   already counts attempts) and auto-escalate — e.g. kick or apply a tag after
   N attempts — instead of only logging.

9. **Container-type coverage.** The illegal-item container sweep doesn't include
   `minecraft:furnace`/`blast_furnace`/`smoker`, `minecraft:brewing_stand`,
   `minecraft:chiseled_bookshelf`, or `minecraft:decorated_pot`. Add them if you
   want full coverage (some can't hold arbitrary items, so weigh the cost).

10. **Unit-testable structure.** Splitting the pure logic (e.g. `isIllegalItem`,
    inventory-diffing) out of the Minecraft API calls would let you test the
    detection rules outside the game.
