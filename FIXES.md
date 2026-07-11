# Vinny's Anticheat — Code Review, Fixes & Recommendations

Review of `scripts/main.js` (behavior pack, `@minecraft/server` 2.4.0).

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
- **Inventory-sync detection is heuristic.** The baseline is committed on a
  timer, so a legitimate item pickup shortly before a respawn can be flagged
  and removed. It ships **disabled by default** (`getInventorySyncSetting()`
  defaults to `false`) for this reason.

---

## Recommendations to add / improve

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
