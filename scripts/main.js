import { world, system, CommandPermissionLevel, CustomCommandParamType, ItemStack } from "@minecraft/server";
import { ActionFormData, ModalFormData, MessageFormData, FormCancelationReason } from "@minecraft/server-ui";

console.warn("[Vinny's Anticheat] Script loading...");

// --- DUPE LOG SCOREBOARD ---
const DUPE_LOG_OBJECTIVE = "dupe_log";
const DUPE_HISTORY_PROPERTY = "cheats:dupeHistory";
const MAX_HISTORY_PER_PLAYER = 5;
const ITEM_WHITELIST_PROPERTY = "cheats:itemWhitelist";
const LAST_OFFENSE_PROPERTY = "cheats:lastOffense";
const ESCALATION_COUNT_PROPERTY = "cheats:escalationCounts";

// Escalation uses its own per-player counter so that low-confidence detections
// (Inventory Sync) can be logged without ever contributing to an auto flag/kick/
// ban. The visible dupe log still counts every attempt.
function getEscCounts() {
    try { const raw = world.getDynamicProperty(ESCALATION_COUNT_PROPERTY); return raw ? JSON.parse(raw) : {}; }
    catch (e) { return {}; }
}
function saveEscCounts(map) {
    try { world.setDynamicProperty(ESCALATION_COUNT_PROPERTY, JSON.stringify(map)); } catch (e) {}
}

// Per-player last offense location, so admins can teleport to investigate.
function getLastOffenses() {
    try { const raw = world.getDynamicProperty(LAST_OFFENSE_PROPERTY); return raw ? JSON.parse(raw) : {}; }
    catch (e) { return {}; }
}
function saveLastOffenses(map) {
    try { world.setDynamicProperty(LAST_OFFENSE_PROPERTY, JSON.stringify(map)); } catch (e) {}
}
function recordLastOffense(player) {
    try {
        const map = getLastOffenses();
        const loc = player.location;
        map[player.name] = { x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z), dim: player.dimension.id };
        saveLastOffenses(map);
    } catch (e) {}
}

function ensureDupeLogObjective() {
    try {
        const existing = world.scoreboard.getObjective(DUPE_LOG_OBJECTIVE);
        if (!existing) world.scoreboard.addObjective(DUPE_LOG_OBJECTIVE, "dummy");
    } catch (e) {
        try { world.scoreboard.addObjective(DUPE_LOG_OBJECTIVE, "dummy"); } catch (e2) {}
    }
}

// escalatable=false logs the attempt (visible in the dupe log) but never counts
// toward or triggers auto-escalation — used for Inventory Sync, which has the
// most false positives and shouldn't get anyone kicked or banned automatically.
function recordDupeAttempt(player, escalatable = true) {
    try {
        ensureDupeLogObjective();
        const objective = world.scoreboard.getObjective(DUPE_LOG_OBJECTIVE);
        if (!objective) return;
        let current = 0;
        try { current = objective.getScore(player.name) ?? 0; } catch (e) {}
        objective.setScore(player.name, current + 1);
        recordLastOffense(player);
        if (escalatable) {
            const counts = getEscCounts();
            const escCount = (counts[player.name] || 0) + 1;
            counts[player.name] = escCount;
            saveEscCounts(counts);
            try { checkEscalation(player, escCount); } catch (e) {}
        }
    } catch (e) { console.warn(`[Anticheat] Failed to record dupe attempt: ${e}`); }
}

function recordDupeHistory(playerName, type, dimension) {
    try {
        const history = getDupeHistory();
        if (!history[playerName]) history[playerName] = [];
        const now = new Date();
        const timestamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
        const dimName = dimension ? dimension.replace("minecraft:", "") : "overworld";
        history[playerName].unshift({ timestamp, type, dimension: dimName });
        if (history[playerName].length > MAX_HISTORY_PER_PLAYER) history[playerName] = history[playerName].slice(0, MAX_HISTORY_PER_PLAYER);
        saveDupeHistory(history);
    } catch (e) { console.warn(`[Anticheat] Failed to record dupe history: ${e}`); }
}

function getDupeHistory() {
    try {
        const raw = world.getDynamicProperty(DUPE_HISTORY_PROPERTY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
}

function saveDupeHistory(history) {
    try { world.setDynamicProperty(DUPE_HISTORY_PROPERTY, JSON.stringify(history)); }
    catch (e) { console.warn(`[Anticheat] Failed to save dupe history: ${e}`); }
}

function clearDupeLog() {
    try {
        const objective = world.scoreboard.getObjective(DUPE_LOG_OBJECTIVE);
        if (!objective) return;
        for (const p of objective.getParticipants()) { try { objective.removeParticipant(p); } catch (e) {} }
        for (const pl of world.getPlayers()) { try { pl.removeTag(FLAGGED_TAG); } catch (e) {} }
        saveLastOffenses({});
        saveEscCounts({});
    } catch (e) {}
}

function clearDupeLogEntry(playerName) {
    try {
        const objective = world.scoreboard.getObjective(DUPE_LOG_OBJECTIVE);
        if (!objective) return false;
        let existed = false;
        try { const current = objective.getScore(playerName); if (current !== undefined) existed = true; } catch (e) {}
        try {
            for (const p of objective.getParticipants()) {
                if (p.displayName === playerName) { objective.removeParticipant(p); break; }
            }
        } catch (e) {}
        removeFlag(playerName);
        try { const m = getLastOffenses(); delete m[playerName]; saveLastOffenses(m); } catch (e) {}
        try { const c = getEscCounts(); delete c[playerName]; saveEscCounts(c); } catch (e) {}
        return existed;
    } catch (e) { return false; }
}

function clearDupeHistoryAll() {
    try { world.setDynamicProperty(DUPE_HISTORY_PROPERTY, JSON.stringify({})); } catch (e) {}
}

function clearDupeHistoryEntry(playerName) {
    try {
        const history = getDupeHistory();
        delete history[playerName];
        saveDupeHistory(history);
    } catch (e) {}
}

function getDupeLogEntries() {
    try {
        const objective = world.scoreboard.getObjective(DUPE_LOG_OBJECTIVE);
        if (!objective) return [];
        const history = getDupeHistory();
        const entries = [];
        for (const name of Object.keys(history)) {
            try {
                const score = objective.getScore(name) ?? 0;
                entries.push({ name, count: score });
            } catch (e) { entries.push({ name, count: 0 }); }
        }
        entries.sort((a, b) => b.count - a.count);
        return entries;
    } catch (e) { return []; }
}

// --- ITEM WHITELIST ---
function getItemWhitelist() {
    try {
        const raw = world.getDynamicProperty(ITEM_WHITELIST_PROPERTY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
}

function saveItemWhitelist(list) {
    try { world.setDynamicProperty(ITEM_WHITELIST_PROPERTY, JSON.stringify(list)); }
    catch (e) { console.warn(`[Anticheat] Failed to save item whitelist: ${e}`); }
}

function isWhitelisted(typeId) {
    const list = getItemWhitelist();
    const normalized = typeId.startsWith("minecraft:") ? typeId : `minecraft:${typeId}`;
    return list.includes(normalized) || list.includes(typeId);
}

// --- ALERT ---
function broadcastAlert(message) {
    const full = `§l§e[Anticheat] §c§lALERT: §f${message}`;
    if (getAdminOnlyAlerts()) {
        for (const p of world.getPlayers()) { if (p.hasTag("admin")) p.sendMessage(full); }
    } else {
        world.sendMessage(full);
    }
}

// Escalation / severe notices always go to admins regardless of the alert mode.
function notifyAdmins(message) {
    const full = `§l§e[Anticheat] §c§lESCALATION: §f${message}`;
    for (const p of world.getPlayers()) { if (p.hasTag("admin")) p.sendMessage(full); }
}

// --- SETTINGS ---
const BUNDLE_BLOCK_PROPERTY = "cheats:blockBundles";
const INVENTORY_SYNC_PROPERTY = "cheats:inventorySync";
const INVENTORY_SYNC_REMOVE_PROPERTY = "cheats:inventorySyncRemove";
const ILLEGAL_ITEMS_PROPERTY = "cheats:illegalItems";
const BANNED_BLOCKS_PROPERTY = "cheats:bannedBlocks";
const BEDROCK_PROTECTION_PROPERTY = "cheats:bedrockProtection";
const MINECART_PROTECTION_PROPERTY = "cheats:minecartProtection";
const PISTON_PROTECTION_PROPERTY = "cheats:pistonProtection";
const PORTAL_PROTECTION_PROPERTY = "cheats:portalProtection";
const ADMIN_ONLY_ALERTS_PROPERTY = "cheats:adminOnlyAlerts";
const ESCALATION_THRESHOLD_PROPERTY = "cheats:escalationThreshold";
const ESCALATION_KICK_PROPERTY = "cheats:escalationKick";
const ESCALATION_ACTION_PROPERTY = "cheats:escalationAction"; // 0 = flag, 1 = kick, 2 = ban
const BANNED_PLAYERS_PROPERTY = "cheats:bannedPlayers";
const FLAGGED_TAG = "cheats:flagged";

function getBundleBlockingSetting() { return world.getDynamicProperty(BUNDLE_BLOCK_PROPERTY) ?? true; }
function setBundleBlockingSetting(v) { world.setDynamicProperty(BUNDLE_BLOCK_PROPERTY, v); }
function getInventorySyncSetting() { return world.getDynamicProperty(INVENTORY_SYNC_PROPERTY) ?? false; }
function setInventorySyncSetting(v) { world.setDynamicProperty(INVENTORY_SYNC_PROPERTY, v); }
function getInventorySyncRemoveSetting() { return world.getDynamicProperty(INVENTORY_SYNC_REMOVE_PROPERTY) ?? true; }
function setInventorySyncRemoveSetting(v) { world.setDynamicProperty(INVENTORY_SYNC_REMOVE_PROPERTY, v); }
function getIllegalItemsSetting() { return world.getDynamicProperty(ILLEGAL_ITEMS_PROPERTY) ?? true; }
function setIllegalItemsSetting(v) { world.setDynamicProperty(ILLEGAL_ITEMS_PROPERTY, v); }
function getBannedBlocksSetting() { return world.getDynamicProperty(BANNED_BLOCKS_PROPERTY) ?? true; }
function setBannedBlocksSetting(v) { world.setDynamicProperty(BANNED_BLOCKS_PROPERTY, v); }
function getBedrockProtectionSetting() { return world.getDynamicProperty(BEDROCK_PROTECTION_PROPERTY) ?? true; }
function setBedrockProtectionSetting(v) { world.setDynamicProperty(BEDROCK_PROTECTION_PROPERTY, v); }
function getMinecartProtectionSetting() { return world.getDynamicProperty(MINECART_PROTECTION_PROPERTY) ?? true; }
function setMinecartProtectionSetting(v) { world.setDynamicProperty(MINECART_PROTECTION_PROPERTY, v); }
function getPistonProtectionSetting() { return world.getDynamicProperty(PISTON_PROTECTION_PROPERTY) ?? true; }
function setPistonProtectionSetting(v) { world.setDynamicProperty(PISTON_PROTECTION_PROPERTY, v); }
function getPortalProtectionSetting() { return world.getDynamicProperty(PORTAL_PROTECTION_PROPERTY) ?? true; }
function setPortalProtectionSetting(v) { world.setDynamicProperty(PORTAL_PROTECTION_PROPERTY, v); }
function getAdminOnlyAlerts() { return world.getDynamicProperty(ADMIN_ONLY_ALERTS_PROPERTY) ?? false; }
function setAdminOnlyAlerts(v) { world.setDynamicProperty(ADMIN_ONLY_ALERTS_PROPERTY, v); }
function getEscalationThreshold() { const v = world.getDynamicProperty(ESCALATION_THRESHOLD_PROPERTY); return typeof v === "number" ? v : 0; }
function setEscalationThreshold(v) { world.setDynamicProperty(ESCALATION_THRESHOLD_PROPERTY, v); }
// Escalation action: 0 = flag only, 1 = kick, 2 = ban. Migrates from the old
// boolean kick setting if the new one was never set.
function getEscalationAction() {
    const v = world.getDynamicProperty(ESCALATION_ACTION_PROPERTY);
    if (typeof v === "number") return v;
    return (world.getDynamicProperty(ESCALATION_KICK_PROPERTY) ?? false) ? 1 : 0;
}
function setEscalationAction(v) { world.setDynamicProperty(ESCALATION_ACTION_PROPERTY, v); }
function escalationActionLabel(a) { return a === 2 ? "ban" : a === 1 ? "kick" : "flag"; }

// --- BAN LIST (Bedrock has no native /ban, so we keep our own and kick on join) ---
function getBanList() {
    try { const raw = world.getDynamicProperty(BANNED_PLAYERS_PROPERTY); return raw ? JSON.parse(raw) : []; }
    catch (e) { return []; }
}
function saveBanList(list) {
    try { world.setDynamicProperty(BANNED_PLAYERS_PROPERTY, JSON.stringify(list)); } catch (e) {}
}
function isBanned(name) { return getBanList().includes(name); }
function addBan(name) { const l = getBanList(); if (!l.includes(name)) { l.push(name); saveBanList(l); } }
function removeBan(name) { const l = getBanList(); const i = l.indexOf(name); if (i !== -1) { l.splice(i, 1); saveBanList(l); return true; } return false; }

function kickPlayer(player, reason) {
    const cmd = `kick "${player.name}" ${reason}`;
    try { player.dimension.runCommand(cmd); }
    catch (e) { try { player.runCommand(cmd); } catch (e2) {} }
}

// Called after an attempt count is incremented. Once a player crosses the
// configured threshold they are flagged (tag) and admins are notified once,
// and depending on the action they are also kicked or banned. The flag tag
// prevents this re-firing every later attempt until their log is cleared.
function checkEscalation(player, newCount) {
    if (player.hasTag("admin")) return; // never auto-punish admins (e.g. while testing)
    const threshold = getEscalationThreshold();
    if (threshold <= 0 || newCount < threshold) return;
    if (player.hasTag(FLAGGED_TAG)) return;
    try { player.addTag(FLAGGED_TAG); } catch (e) {}
    const action = getEscalationAction();
    const verb = action === 2 ? "§cbanning" : action === 1 ? "§ckicking" : "§eflagged";
    notifyAdmins(`§e${player.name}§f reached §c${newCount}§f attempts — ${verb}§f.`);
    if (action === 2) {
        addBan(player.name);
        kickPlayer(player, "Anticheat: banned for repeated dupe/exploit attempts");
    } else if (action === 1) {
        kickPlayer(player, "Anticheat: repeated dupe/exploit attempts");
    }
}

// Enforce bans: a banned player is kicked as soon as they finish joining.
world.afterEvents.playerSpawn.subscribe((event) => {
    if (!event.initialSpawn) return;
    const player = event.player;
    if (player.hasTag("admin")) return; // safety: never lock an admin out
    if (isBanned(player.name)) {
        system.runTimeout(() => { try { kickPlayer(player, "Anticheat: you are banned from this world"); } catch (e) {} }, 20);
    }
});

// Remove the escalation flag from a player (by name) if they are online, so
// clearing their log gives them a clean slate.
function removeFlag(playerName) {
    for (const p of world.getPlayers()) {
        if (p.name === playerName) { try { p.removeTag(FLAGGED_TAG); } catch (e) {} }
    }
}

// --- COMMANDS ---
system.beforeEvents.startup.subscribe((init) => {
    console.warn("[Vinny's Anticheat] Startup event fired!");
    const registry = init.customCommandRegistry;

    registry.registerCommand(
        { name: "cheats:help", description: "List all Anticheat commands", permissionLevel: CommandPermissionLevel.Any },
        (origin) => {
            const player = origin.sourceEntity;
            if (!player || player.typeId !== "minecraft:player") return { status: 0 };
            const isAdmin = player.hasTag("admin");
            system.run(() => {
                let msg = `§e[Anticheat] §lCommands§r\n`;
                msg += `\n§aToggles §7(requires operator):§r\n`;
                msg += `  §f/cheats:bundles §7- Toggle Bundle/Shulker Box blocking\n`;
                msg += `  §f/cheats:invcheck §7- Toggle Inventory Sync\n`;
                msg += `  §f/cheats:invremove §7- Toggle Inv Sync item removal (off = alert only)\n`;
                msg += `  §f/cheats:illegalitems §7- Toggle Illegal Item Detection\n`;
                msg += `  §f/cheats:bannedblocks §7- Toggle Banned Block Detection\n`;
                msg += `  §f/cheats:bedrock §7- Toggle Bedrock Break Protection\n`;
                msg += `  §f/cheats:minecart §7- Toggle Minecart Chest Dupe Detection\n`;
                msg += `  §f/cheats:piston §7- Toggle Piston Dupe Protection\n`;
                msg += `  §f/cheats:portal §7- Toggle Nether Portal Dupe Protection\n`;
                msg += `  §f/cheats:alerts §7- Toggle Admin-Only Alerts\n`;
                msg += `  §f/cheats:escalate [n] §7- Set auto-flag/kick threshold (0=off)\n`;
                msg += `\n§aInfo:§r\n`;
                msg += `  §f/cheats:ui §7- Open the control panel (operators)\n`;
                msg += `  §f/cheats:status §7- View all toggle states\n`;
                msg += `  §f/cheats:admin <add/remove/list> [player] §7- Manage admins (operator)\n`;
                msg += `  §f/cheats:help §7- Show this list\n`;
                if (isAdmin) {
                    msg += `\n§aAdmin §7(requires admin tag):§r\n`;
                    msg += `  §f/cheats:viewlog §7- View the dupe log\n`;
                    msg += `  §f/cheats:history <player> §7- View a player's history\n`;
                    msg += `  §f/cheats:tp <player> §7- Teleport to a player's last offense\n`;
                    msg += `  §f/cheats:clearlog [player] §7- Clear the dupe log\n`;
                    msg += `  §f/cheats:banlist §7- View banned players\n`;
                    msg += `  §f/cheats:ban <player> §7- Ban a player\n`;
                    msg += `  §f/cheats:unban <player> §7- Unban a player\n`;
                    msg += `  §f/cheats:whitelist <add/remove/list> [item] §7- Manage whitelist\n`;
                    msg += `  §f/cheats:whitelisthand §7- Whitelist item in hand\n`;
                }
                player.sendMessage(msg);
            });
            return { status: 0 };
        }
    );

    registry.registerCommand(
        { name: "cheats:status", description: "View all toggle states", permissionLevel: CommandPermissionLevel.Any },
        (origin) => {
            const player = origin.sourceEntity;
            if (!player || player.typeId !== "minecraft:player") return { status: 0 };
            system.run(() => {
                player.sendMessage(
                    `§e[Anticheat] Status:§r\n` +
                    `  Bundle/Shulker Box Blocking: ${getBundleBlockingSetting() ? "§aENABLED" : "§cDISABLED"}§r\n` +
                    `  Inventory Sync: ${getInventorySyncSetting() ? `§aENABLED §7(${getInventorySyncRemoveSetting() ? "removes items" : "alert only"})` : "§cDISABLED"}§r\n` +
                    `  Illegal Item Detection: ${getIllegalItemsSetting() ? "§aENABLED" : "§cDISABLED"}§r\n` +
                    `  Banned Block Detection: ${getBannedBlocksSetting() ? "§aENABLED" : "§cDISABLED"}§r\n` +
                    `  Bedrock Break Protection: ${getBedrockProtectionSetting() ? "§aENABLED" : "§cDISABLED"}§r\n` +
                    `  Minecart Chest Dupe Detection: ${getMinecartProtectionSetting() ? "§aENABLED" : "§cDISABLED"}§r\n` +
                    `  Piston Dupe Protection: ${getPistonProtectionSetting() ? "§aENABLED" : "§cDISABLED"}§r\n` +
                    `  Nether Portal Dupe Protection: ${getPortalProtectionSetting() ? "§aENABLED" : "§cDISABLED"}§r\n` +
                    `  Admin-Only Alerts: ${getAdminOnlyAlerts() ? "§aENABLED" : "§cDISABLED"}§r\n` +
                    `  Auto-Escalation: ${getEscalationThreshold() > 0 ? `§aAt ${getEscalationThreshold()} (${escalationActionLabel(getEscalationAction())})` : "§cDISABLED"}§r\n`
                );
            });
            return { status: 0 };
        }
    );

    registry.registerCommand(
        { name: "cheats:bundles", description: "Toggle Bundle/Shulker Box blocking", permissionLevel: CommandPermissionLevel.GameDirectors },
        (origin) => {
            const player = origin.sourceEntity;
            if (!player || player.typeId !== "minecraft:player") return { status: 0 };
            system.run(() => { const v = !getBundleBlockingSetting(); setBundleBlockingSetting(v); player.sendMessage(`§e[Anticheat]§r Bundle/Shulker Blocking: ${v ? "§aENABLED" : "§cDISABLED"}`); });
            return { status: 0 };
        }
    );

    registry.registerCommand(
        { name: "cheats:invcheck", description: "Toggle Inventory Sync", permissionLevel: CommandPermissionLevel.GameDirectors },
        (origin) => {
            const player = origin.sourceEntity;
            if (!player || player.typeId !== "minecraft:player") return { status: 0 };
            system.run(() => { const v = !getInventorySyncSetting(); setInventorySyncSetting(v); player.sendMessage(`§e[Anticheat]§r Inventory Sync: ${v ? "§aENABLED" : "§cDISABLED"}`); });
            return { status: 0 };
        }
    );

    registry.registerCommand(
        { name: "cheats:invremove", description: "Toggle whether Inventory Sync removes items (off = alert only)", permissionLevel: CommandPermissionLevel.GameDirectors },
        (origin) => {
            const player = origin.sourceEntity;
            if (!player || player.typeId !== "minecraft:player") return { status: 0 };
            system.run(() => { const v = !getInventorySyncRemoveSetting(); setInventorySyncRemoveSetting(v); player.sendMessage(`§e[Anticheat]§r Inv Sync Item Removal: ${v ? "§aENABLED" : "§calert only"}`); });
            return { status: 0 };
        }
    );

    registry.registerCommand(
        { name: "cheats:illegalitems", description: "Toggle Illegal Item Detection", permissionLevel: CommandPermissionLevel.GameDirectors },
        (origin) => {
            const player = origin.sourceEntity;
            if (!player || player.typeId !== "minecraft:player") return { status: 0 };
            system.run(() => { const v = !getIllegalItemsSetting(); setIllegalItemsSetting(v); player.sendMessage(`§e[Anticheat]§r Illegal Item Detection: ${v ? "§aENABLED" : "§cDISABLED"}`); });
            return { status: 0 };
        }
    );

    registry.registerCommand(
        { name: "cheats:bannedblocks", description: "Toggle Banned Block Detection", permissionLevel: CommandPermissionLevel.GameDirectors },
        (origin) => {
            const player = origin.sourceEntity;
            if (!player || player.typeId !== "minecraft:player") return { status: 0 };
            system.run(() => { const v = !getBannedBlocksSetting(); setBannedBlocksSetting(v); player.sendMessage(`§e[Anticheat]§r Banned Block Detection: ${v ? "§aENABLED" : "§cDISABLED"}`); });
            return { status: 0 };
        }
    );

    registry.registerCommand(
        { name: "cheats:bedrock", description: "Toggle Bedrock Break Protection", permissionLevel: CommandPermissionLevel.GameDirectors },
        (origin) => {
            const player = origin.sourceEntity;
            if (!player || player.typeId !== "minecraft:player") return { status: 0 };
            system.run(() => { const v = !getBedrockProtectionSetting(); setBedrockProtectionSetting(v); player.sendMessage(`§e[Anticheat]§r Bedrock Break Protection: ${v ? "§aENABLED" : "§cDISABLED"}`); });
            return { status: 0 };
        }
    );

    registry.registerCommand(
        { name: "cheats:minecart", description: "Toggle Minecart Chest Dupe Detection", permissionLevel: CommandPermissionLevel.GameDirectors },
        (origin) => {
            const player = origin.sourceEntity;
            if (!player || player.typeId !== "minecraft:player") return { status: 0 };
            system.run(() => { const v = !getMinecartProtectionSetting(); setMinecartProtectionSetting(v); player.sendMessage(`§e[Anticheat]§r Minecart Dupe Detection: ${v ? "§aENABLED" : "§cDISABLED"}`); });
            return { status: 0 };
        }
    );

    registry.registerCommand(
        { name: "cheats:piston", description: "Toggle Piston Dupe Protection", permissionLevel: CommandPermissionLevel.GameDirectors },
        (origin) => {
            const player = origin.sourceEntity;
            if (!player || player.typeId !== "minecraft:player") return { status: 0 };
            system.run(() => { const v = !getPistonProtectionSetting(); setPistonProtectionSetting(v); player.sendMessage(`§e[Anticheat]§r Piston Dupe Protection: ${v ? "§aENABLED" : "§cDISABLED"}`); });
            return { status: 0 };
        }
    );

    registry.registerCommand(
        { name: "cheats:portal", description: "Toggle Nether Portal Dupe Protection", permissionLevel: CommandPermissionLevel.GameDirectors },
        (origin) => {
            const player = origin.sourceEntity;
            if (!player || player.typeId !== "minecraft:player") return { status: 0 };
            system.run(() => { const v = !getPortalProtectionSetting(); setPortalProtectionSetting(v); player.sendMessage(`§e[Anticheat]§r Nether Portal Dupe Protection: ${v ? "§aENABLED" : "§cDISABLED"}`); });
            return { status: 0 };
        }
    );

    registry.registerCommand(
        { name: "cheats:alerts", description: "Toggle admin-only alerts", permissionLevel: CommandPermissionLevel.GameDirectors },
        (origin) => {
            const player = origin.sourceEntity;
            if (!player || player.typeId !== "minecraft:player") return { status: 0 };
            system.run(() => { const v = !getAdminOnlyAlerts(); setAdminOnlyAlerts(v); player.sendMessage(`§e[Anticheat]§r Admin-Only Alerts: ${v ? "§aENABLED" : "§cDISABLED"}`); });
            return { status: 0 };
        }
    );

    registry.registerCommand(
        { name: "cheats:escalate", description: "Set auto-escalation threshold (0 = off)", permissionLevel: CommandPermissionLevel.GameDirectors,
          optionalParameters: [{ name: "threshold", type: CustomCommandParamType.Integer }] },
        (origin, threshold) => {
            const player = origin.sourceEntity;
            if (!player || player.typeId !== "minecraft:player") return { status: 0 };
            system.run(() => {
                if (threshold === undefined || threshold === null) {
                    const t = getEscalationThreshold();
                    player.sendMessage(`§e[Anticheat]§r Auto-escalation: ${t > 0 ? `§aAt ${t} attempts (${escalationActionLabel(getEscalationAction())})` : "§cDISABLED"}`);
                    return;
                }
                const t = Math.max(0, Math.floor(threshold));
                setEscalationThreshold(t);
                player.sendMessage(`§e[Anticheat]§r Auto-escalation threshold set to §a${t}§r${t === 0 ? " §7(disabled)" : ""}.`);
            });
            return { status: 0 };
        }
    );

    registry.registerCommand(
        { name: "cheats:viewlog", description: "View the dupe log (requires admin tag)", permissionLevel: CommandPermissionLevel.Any },
        (origin) => {
            const player = origin.sourceEntity;
            if (!player || player.typeId !== "minecraft:player") return { status: 0 };
            system.run(() => {
                if (!player.hasTag("admin")) { player.sendMessage(`§e[Anticheat]§c No permission.`); return; }
                const entries = getDupeLogEntries();
                if (entries.length === 0) { player.sendMessage(`§e[Anticheat]§r Dupe log is empty.`); return; }
                let msg = `§e[Anticheat] §lDupe Log§r §7(${entries.length} player${entries.length !== 1 ? "s" : ""})§r\n`;
                for (const entry of entries) msg += `  §c${entry.name}§r — §f${entry.count} attempt${entry.count !== 1 ? "s" : ""}§r\n`;
                msg += `\n§7Use /cheats:history <name> for details.`;
                player.sendMessage(msg);
            });
            return { status: 0 };
        }
    );

    registry.registerCommand(
        { name: "cheats:history", description: "View a player's dupe history (requires admin tag)", permissionLevel: CommandPermissionLevel.Any,
          mandatoryParameters: [{ name: "playerName", type: CustomCommandParamType.String }] },
        (origin, playerName) => {
            const player = origin.sourceEntity;
            if (!player || player.typeId !== "minecraft:player") return { status: 0 };
            system.run(() => {
                if (!player.hasTag("admin")) { player.sendMessage(`§e[Anticheat]§c No permission.`); return; }
                const history = getDupeHistory();
                const playerHistory = history[playerName];
                const objective = world.scoreboard.getObjective(DUPE_LOG_OBJECTIVE);
                let totalCount = 0;
                if (objective) { try { totalCount = objective.getScore(playerName) ?? 0; } catch (e) {} }
                if (!playerHistory || playerHistory.length === 0) { player.sendMessage(`§e[Anticheat]§r No history found for §c${playerName}§r.`); return; }
                let msg = `§e[Anticheat] §lHistory for §c${playerName}§r §7(${totalCount} total)§r\n`;
                for (const h of playerHistory) msg += `\n  §e${h.timestamp}§r\n  §fType: ${h.type}§r\n  §fDimension: ${h.dimension}§r\n`;
                player.sendMessage(msg);
            });
            return { status: 0 };
        }
    );

    registry.registerCommand(
        { name: "cheats:clearlog", description: "Clear the dupe log (requires admin tag)", permissionLevel: CommandPermissionLevel.Any,
          optionalParameters: [{ name: "playerName", type: CustomCommandParamType.String }] },
        (origin, playerName) => {
            const player = origin.sourceEntity;
            if (!player || player.typeId !== "minecraft:player") return { status: 0 };
            system.run(() => {
                if (!player.hasTag("admin")) { player.sendMessage(`§e[Anticheat]§c No permission.`); return; }
                if (playerName) {
                    clearDupeLogEntry(playerName);
                    clearDupeHistoryEntry(playerName);
                    player.sendMessage(`§e[Anticheat]§r Cleared log for §c${playerName}§r.`);
                } else {
                    clearDupeLog();
                    clearDupeHistoryAll();
                    player.sendMessage(`§e[Anticheat]§r Dupe log §acleared§r.`);
                }
            });
            return { status: 0 };
        }
    );

    registry.registerCommand(
        { name: "cheats:banlist", description: "View banned players (requires admin tag)", permissionLevel: CommandPermissionLevel.Any },
        (origin) => {
            const player = origin.sourceEntity;
            if (!player || player.typeId !== "minecraft:player") return { status: 0 };
            system.run(() => {
                if (!player.hasTag("admin")) { player.sendMessage(`§e[Anticheat]§c No permission.`); return; }
                const list = getBanList();
                if (list.length === 0) { player.sendMessage(`§e[Anticheat]§r No players are banned.`); return; }
                let msg = `§e[Anticheat] §lBanned Players§r §7(${list.length})§r\n`;
                for (const n of list) msg += `  §c${n}\n`;
                msg += `\n§7Use /cheats:unban <name> to lift a ban.`;
                player.sendMessage(msg);
            });
            return { status: 0 };
        }
    );

    registry.registerCommand(
        { name: "cheats:ban", description: "Ban a player (requires admin tag)", permissionLevel: CommandPermissionLevel.Any,
          mandatoryParameters: [{ name: "playerName", type: CustomCommandParamType.String }] },
        (origin, playerName) => {
            const player = origin.sourceEntity;
            if (!player || player.typeId !== "minecraft:player") return { status: 0 };
            system.run(() => {
                if (!player.hasTag("admin")) { player.sendMessage(`§e[Anticheat]§c No permission.`); return; }
                const name = (playerName || "").trim();
                if (!name) { player.sendMessage(`§e[Anticheat]§c Please specify a player name.`); return; }
                let target = null;
                for (const p of world.getPlayers()) { if (p.name === name) { target = p; break; } }
                if (target && target.hasTag("admin")) { player.sendMessage(`§e[Anticheat]§c You cannot ban an admin.`); return; }
                addBan(name);
                if (target) kickPlayer(target, "Anticheat: you are banned from this world");
                player.sendMessage(`§e[Anticheat]§r §c${name}§r has been §cbanned§r${target ? " and kicked" : " (will be kicked on join)"}.`);
            });
            return { status: 0 };
        }
    );

    registry.registerCommand(
        { name: "cheats:unban", description: "Unban a player (requires admin tag)", permissionLevel: CommandPermissionLevel.Any,
          mandatoryParameters: [{ name: "playerName", type: CustomCommandParamType.String }] },
        (origin, playerName) => {
            const player = origin.sourceEntity;
            if (!player || player.typeId !== "minecraft:player") return { status: 0 };
            system.run(() => {
                if (!player.hasTag("admin")) { player.sendMessage(`§e[Anticheat]§c No permission.`); return; }
                const name = (playerName || "").trim();
                if (!name) { player.sendMessage(`§e[Anticheat]§c Please specify a player name.`); return; }
                if (removeBan(name)) player.sendMessage(`§e[Anticheat]§r §a${name}§r has been §aunbanned§r.`);
                else player.sendMessage(`§e[Anticheat]§r §c${name}§r is not banned.`);
            });
            return { status: 0 };
        }
    );

    registry.registerCommand(
        { name: "cheats:admin", description: "Manage anticheat admins (requires operator)", permissionLevel: CommandPermissionLevel.GameDirectors,
          mandatoryParameters: [{ name: "action", type: CustomCommandParamType.String }],
          optionalParameters: [{ name: "playerName", type: CustomCommandParamType.String }] },
        (origin, action, playerName) => {
            const player = origin.sourceEntity;
            if (!player || player.typeId !== "minecraft:player") return { status: 0 };
            system.run(() => {
                const act = (action || "").toLowerCase();
                if (act === "list") {
                    const admins = world.getPlayers().filter((p) => p.hasTag("admin")).map((p) => p.name);
                    if (admins.length === 0) { player.sendMessage(`§e[Anticheat]§r No online players have the admin tag.`); return; }
                    let msg = `§e[Anticheat] §lAdmins online§r §7(${admins.length})§r\n`;
                    for (const n of admins) msg += `  §a${n}\n`;
                    player.sendMessage(msg);
                    return;
                }
                const name = (playerName || "").trim();
                if (!name) { player.sendMessage(`§e[Anticheat]§c Please specify a player name.`); return; }
                let target = null;
                for (const p of world.getPlayers()) { if (p.name === name) { target = p; break; } }
                if (!target) { player.sendMessage(`§e[Anticheat]§c Player §f${name}§c not found (must be online).`); return; }
                if (act === "add") {
                    if (target.hasTag("admin")) { player.sendMessage(`§e[Anticheat]§r §a${name}§r is already an admin.`); return; }
                    target.addTag("admin");
                    player.sendMessage(`§e[Anticheat]§r §a${name}§r is now an admin.`);
                    target.sendMessage(`§e[Anticheat]§r You have been made an anticheat §aadmin§r.`);
                } else if (act === "remove") {
                    if (!target.hasTag("admin")) { player.sendMessage(`§e[Anticheat]§r §f${name}§r is not an admin.`); return; }
                    target.removeTag("admin");
                    player.sendMessage(`§e[Anticheat]§r §c${name}§r is no longer an admin.`);
                } else {
                    player.sendMessage(`§e[Anticheat]§c Unknown action. Use: add, remove, or list`);
                }
            });
            return { status: 0 };
        }
    );

    registry.registerCommand(
        { name: "cheats:tp", description: "Teleport to a player's last dupe location (requires admin tag)", permissionLevel: CommandPermissionLevel.Any,
          mandatoryParameters: [{ name: "playerName", type: CustomCommandParamType.String }] },
        (origin, playerName) => {
            const player = origin.sourceEntity;
            if (!player || player.typeId !== "minecraft:player") return { status: 0 };
            system.run(() => {
                if (!player.hasTag("admin")) { player.sendMessage(`§e[Anticheat]§c No permission.`); return; }
                const name = (playerName || "").trim();
                if (!name) { player.sendMessage(`§e[Anticheat]§c Please specify a player name.`); return; }
                const loc = getLastOffenses()[name];
                if (!loc) { player.sendMessage(`§e[Anticheat]§r No recorded offense location for §c${name}§r.`); return; }
                try {
                    player.teleport({ x: loc.x + 0.5, y: loc.y, z: loc.z + 0.5 }, { dimension: world.getDimension(loc.dim) });
                    player.sendMessage(`§e[Anticheat]§r Teleported to §c${name}§r's last offense §7(${loc.x}, ${loc.y}, ${loc.z} in ${loc.dim.replace("minecraft:", "")})§r.`);
                } catch (e) { player.sendMessage(`§e[Anticheat]§c Teleport failed: ${e}`); }
            });
            return { status: 0 };
        }
    );

    registry.registerCommand(
        { name: "cheats:whitelist", description: "Manage the item whitelist (requires admin tag)", permissionLevel: CommandPermissionLevel.GameDirectors,
          mandatoryParameters: [{ name: "action", type: CustomCommandParamType.String }],
          optionalParameters: [{ name: "itemId", type: CustomCommandParamType.String }] },
        (origin, action, itemId) => {
            const player = origin.sourceEntity;
            if (!player || player.typeId !== "minecraft:player") return { status: 0 };
            system.run(() => {
                const act = action?.toLowerCase();
                if (act === "list") {
                    const list = getItemWhitelist();
                    if (list.length === 0) { player.sendMessage(`§e[Anticheat]§r Whitelist is empty.`); return; }
                    let msg = `§e[Anticheat] §lWhitelist§r\n`;
                    for (const item of list) msg += `  §f${item}\n`;
                    player.sendMessage(msg);
                    return;
                }
                if (!itemId) { player.sendMessage(`§e[Anticheat]§c Please specify an item ID.`); return; }
                const normalized = itemId.startsWith("minecraft:") ? itemId : `minecraft:${itemId}`;
                const list = getItemWhitelist();
                if (act === "add") {
                    if (list.includes(normalized)) { player.sendMessage(`§e[Anticheat]§r Already whitelisted.`); return; }
                    list.push(normalized); saveItemWhitelist(list);
                    player.sendMessage(`§e[Anticheat]§r §a${normalized}§r added to whitelist.`);
                } else if (act === "remove") {
                    const index = list.indexOf(normalized);
                    if (index === -1) { player.sendMessage(`§e[Anticheat]§r Not on whitelist.`); return; }
                    list.splice(index, 1); saveItemWhitelist(list);
                    player.sendMessage(`§e[Anticheat]§r §c${normalized}§r removed from whitelist.`);
                } else {
                    player.sendMessage(`§e[Anticheat]§c Unknown action. Use: add, remove, or list`);
                }
            });
            return { status: 0 };
        }
    );

    registry.registerCommand(
        { name: "cheats:whitelisthand", description: "Whitelist the item in your hand", permissionLevel: CommandPermissionLevel.GameDirectors },
        (origin) => {
            const player = origin.sourceEntity;
            if (!player || player.typeId !== "minecraft:player") return { status: 0 };
            system.run(() => {
                try {
                    const equippable = player.getComponent("equippable");
                    const item = equippable?.getEquipment("Mainhand");
                    if (!item) { player.sendMessage(`§e[Anticheat]§c You are not holding any item.`); return; }
                    const normalized = item.typeId.startsWith("minecraft:") ? item.typeId : `minecraft:${item.typeId}`;
                    const list = getItemWhitelist();
                    if (list.includes(normalized)) { player.sendMessage(`§e[Anticheat]§r Already whitelisted.`); return; }
                    list.push(normalized); saveItemWhitelist(list);
                    player.sendMessage(`§e[Anticheat]§r §a${normalized}§r added to whitelist.`);
                } catch (e) { player.sendMessage(`§e[Anticheat]§c Error: ${e}`); }
            });
            return { status: 0 };
        }
    );

    registry.registerCommand(
        { name: "cheats:ui", description: "Open the Anticheat control panel (requires admin tag)", permissionLevel: CommandPermissionLevel.GameDirectors },
        (origin) => {
            const player = origin.sourceEntity;
            if (!player || player.typeId !== "minecraft:player") return { status: 0 };
            // Forms cannot be shown from the read-only command context, so defer
            // to the next tick. openMainMenu retries past the initial "UserBusy".
            system.run(() => {
                // Operator level alone is not enough — the panel is admin-tag gated.
                if (!player.hasTag("admin")) { player.sendMessage(`§e[Anticheat]§c No permission. (requires admin tag)`); return; }
                openMainMenu(player).catch((e) => console.warn(`[Anticheat] UI error: ${e}`));
            });
            return { status: 0 };
        }
    );
});

// --- UI CONTROL PANEL ---
// Opening a form right after a command sometimes returns UserBusy (the chat is
// still closing). Retry a few times before giving up.
async function showForm(player, form) {
    for (let attempt = 0; attempt < 20; attempt++) {
        const response = await form.show(player);
        if (response.canceled && response.cancelationReason === FormCancelationReason.UserBusy) {
            await system.waitTicks(10);
            continue;
        }
        return response;
    }
    return undefined;
}

async function openMainMenu(player) {
    const isAdmin = player.hasTag("admin");
    const form = new ActionFormData()
        .title("Vinny's Anticheat")
        .body("Select an option:");
    const actions = [];
    form.button("Settings & Toggles");
    actions.push(openTogglesMenu);
    if (isAdmin) {
        form.button("Dupe Log");        actions.push(openDupeLogMenu);
        form.button("Player History");  actions.push(openHistoryPrompt);
        form.button("Clear Log");       actions.push(openClearLogMenu);
        form.button("Whitelist");       actions.push(openWhitelistMenu);
        form.button("Bans");            actions.push(openBansMenu);
    }
    const res = await showForm(player, form);
    if (!res || res.canceled) return;
    const handler = actions[res.selection];
    if (handler) await handler(player);
}

async function openTogglesMenu(player) {
    const form = new ModalFormData()
        .title("Settings")
        .toggle("Bundle/Shulker Box Blocking", { defaultValue: getBundleBlockingSetting() })
        .toggle("Inventory Sync", { defaultValue: getInventorySyncSetting() })
        .toggle("Inv Sync: Remove Items (off = alert only)", { defaultValue: getInventorySyncRemoveSetting() })
        .toggle("Illegal Item Detection", { defaultValue: getIllegalItemsSetting() })
        .toggle("Banned Block Detection", { defaultValue: getBannedBlocksSetting() })
        .toggle("Bedrock Break Protection", { defaultValue: getBedrockProtectionSetting() })
        .toggle("Minecart Chest Dupe Detection", { defaultValue: getMinecartProtectionSetting() })
        .toggle("Piston Dupe Protection", { defaultValue: getPistonProtectionSetting() })
        .toggle("Nether Portal Dupe Protection", { defaultValue: getPortalProtectionSetting() })
        .toggle("Admin-Only Alerts", { defaultValue: getAdminOnlyAlerts() })
        .slider("Auto-flag threshold (0 = off)", 0, 25, { defaultValue: getEscalationThreshold() })
        .dropdown("Action at threshold", ["Flag only", "Kick", "Ban"], { defaultValueIndex: getEscalationAction() });
    const res = await showForm(player, form);
    if (!res || res.canceled) return;
    const v = res.formValues;
    setBundleBlockingSetting(!!v[0]);
    setInventorySyncSetting(!!v[1]);
    setInventorySyncRemoveSetting(!!v[2]);
    setIllegalItemsSetting(!!v[3]);
    setBannedBlocksSetting(!!v[4]);
    setBedrockProtectionSetting(!!v[5]);
    setMinecartProtectionSetting(!!v[6]);
    setPistonProtectionSetting(!!v[7]);
    setPortalProtectionSetting(!!v[8]);
    setAdminOnlyAlerts(!!v[9]);
    setEscalationThreshold(Math.max(0, Math.floor(v[10] ?? 0)));
    setEscalationAction(Math.max(0, Math.min(2, v[11] ?? 0)));
    player.sendMessage("§e[Anticheat]§r Settings updated.");
}

async function openDupeLogMenu(player) {
    const entries = getDupeLogEntries();
    const form = new ActionFormData().title("Dupe Log");
    if (entries.length === 0) {
        form.body("The dupe log is empty.").button("Back");
        const r = await showForm(player, form);
        if (r && !r.canceled) await openMainMenu(player);
        return;
    }
    form.body(`${entries.length} player(s) logged. Select one to view history.`);
    for (const e of entries) form.button(`${e.name}\n§7${e.count} attempt${e.count !== 1 ? "s" : ""}`);
    const res = await showForm(player, form);
    if (!res || res.canceled) return;
    const chosen = entries[res.selection];
    if (chosen) await showPlayerHistory(player, chosen.name);
}

async function showPlayerHistory(player, name) {
    const history = getDupeHistory()[name];
    const objective = world.scoreboard.getObjective(DUPE_LOG_OBJECTIVE);
    let total = 0;
    if (objective) { try { total = objective.getScore(name) ?? 0; } catch (e) {} }
    let body;
    if (!history || history.length === 0) {
        body = `No history found for ${name}.`;
    } else {
        body = `§7Total attempts: ${total}§r\n`;
        for (const h of history) body += `\n§e${h.timestamp}§r\n§fType: ${h.type}§r\n§fDimension: ${h.dimension}§r\n`;
    }
    const loc = getLastOffenses()[name];
    const form = new ActionFormData().title(`History: ${name}`).body(body);
    if (loc) form.button(`Teleport to last offense\n§7${loc.x}, ${loc.y}, ${loc.z}`);
    form.button("Back");
    const r = await showForm(player, form);
    if (!r || r.canceled) return;
    if (loc && r.selection === 0) {
        try {
            player.teleport({ x: loc.x + 0.5, y: loc.y, z: loc.z + 0.5 }, { dimension: world.getDimension(loc.dim) });
            player.sendMessage(`§e[Anticheat]§r Teleported to §c${name}§r's last offense §7(${loc.x}, ${loc.y}, ${loc.z})§r.`);
        } catch (e) { player.sendMessage(`§e[Anticheat]§c Teleport failed: ${e}`); }
        return;
    }
    await openMainMenu(player);
}

async function openHistoryPrompt(player) {
    const form = new ModalFormData().title("Player History").textField("Player name", "Enter exact name");
    const res = await showForm(player, form);
    if (!res || res.canceled) return;
    const name = (res.formValues[0] || "").trim();
    if (!name) { player.sendMessage("§e[Anticheat]§c No name entered."); return; }
    await showPlayerHistory(player, name);
}

async function openClearLogMenu(player) {
    const form = new ActionFormData()
        .title("Clear Dupe Log")
        .body("Choose what to clear:")
        .button("Clear ALL")
        .button("Clear a specific player")
        .button("Back");
    const res = await showForm(player, form);
    if (!res || res.canceled) return;
    if (res.selection === 0) {
        const confirm = new MessageFormData()
            .title("Confirm")
            .body("Clear the ENTIRE dupe log? This cannot be undone.")
            .button1("Cancel")
            .button2("Clear ALL");
        const c = await showForm(player, confirm);
        if (c && !c.canceled && c.selection === 1) {
            clearDupeLog(); clearDupeHistoryAll();
            player.sendMessage("§e[Anticheat]§r Dupe log §acleared§r.");
        }
    } else if (res.selection === 1) {
        const modal = new ModalFormData().title("Clear Player").textField("Player name", "Enter exact name");
        const m = await showForm(player, modal);
        if (m && !m.canceled) {
            const name = (m.formValues[0] || "").trim();
            if (!name) { player.sendMessage("§e[Anticheat]§c No name entered."); return; }
            clearDupeLogEntry(name); clearDupeHistoryEntry(name);
            player.sendMessage(`§e[Anticheat]§r Cleared log for §c${name}§r.`);
        }
    } else {
        await openMainMenu(player);
    }
}

async function openWhitelistMenu(player) {
    const list = getItemWhitelist();
    const form = new ActionFormData()
        .title("Item Whitelist")
        .body(list.length ? `${list.length} item(s) whitelisted.` : "Whitelist is empty.")
        .button("View List")
        .button("Add by ID")
        .button("Add Item in Hand")
        .button("Remove Item")
        .button("Back");
    const res = await showForm(player, form);
    if (!res || res.canceled) return;
    switch (res.selection) {
        case 0: {
            const body = list.length ? list.map((i) => `§f${i}`).join("\n") : "Whitelist is empty.";
            const f = new ActionFormData().title("Whitelist").body(body).button("Back");
            const r = await showForm(player, f);
            if (r && !r.canceled) await openWhitelistMenu(player);
            break;
        }
        case 1: {
            const modal = new ModalFormData().title("Add to Whitelist").textField("Item ID", "e.g. diamond or minecraft:diamond");
            const m = await showForm(player, modal);
            if (m && !m.canceled) {
                const raw = (m.formValues[0] || "").trim();
                if (!raw) { player.sendMessage("§e[Anticheat]§c No item ID entered."); break; }
                const normalized = raw.startsWith("minecraft:") ? raw : `minecraft:${raw}`;
                const l = getItemWhitelist();
                if (l.includes(normalized)) player.sendMessage("§e[Anticheat]§r Already whitelisted.");
                else { l.push(normalized); saveItemWhitelist(l); player.sendMessage(`§e[Anticheat]§r §a${normalized}§r added.`); }
            }
            break;
        }
        case 2: {
            try {
                const item = player.getComponent("equippable")?.getEquipment("Mainhand");
                if (!item) { player.sendMessage("§e[Anticheat]§c You are not holding any item."); break; }
                const normalized = item.typeId.startsWith("minecraft:") ? item.typeId : `minecraft:${item.typeId}`;
                const l = getItemWhitelist();
                if (l.includes(normalized)) player.sendMessage("§e[Anticheat]§r Already whitelisted.");
                else { l.push(normalized); saveItemWhitelist(l); player.sendMessage(`§e[Anticheat]§r §a${normalized}§r added.`); }
            } catch (e) { player.sendMessage(`§e[Anticheat]§c Error: ${e}`); }
            break;
        }
        case 3: {
            if (list.length === 0) { player.sendMessage("§e[Anticheat]§r Whitelist is empty."); break; }
            const modal = new ModalFormData().title("Remove from Whitelist").dropdown("Select item", list, { defaultValueIndex: 0 });
            const m = await showForm(player, modal);
            if (m && !m.canceled) {
                const target = list[m.formValues[0]];
                const l = getItemWhitelist();
                const i = l.indexOf(target);
                if (i !== -1) { l.splice(i, 1); saveItemWhitelist(l); player.sendMessage(`§e[Anticheat]§r §c${target}§r removed.`); }
            }
            break;
        }
        default:
            await openMainMenu(player);
    }
}

async function openBansMenu(player) {
    const list = getBanList();
    const form = new ActionFormData()
        .title("Banned Players")
        .body(list.length ? `${list.length} player(s) banned.` : "No players are banned.")
        .button("View / Unban")
        .button("Ban a Player")
        .button("Back");
    const res = await showForm(player, form);
    if (!res || res.canceled) return;
    switch (res.selection) {
        case 0: {
            if (list.length === 0) { player.sendMessage("§e[Anticheat]§r No players are banned."); break; }
            const modal = new ModalFormData()
                .title("Unban Player")
                .dropdown("Select player to unban", list, { defaultValueIndex: 0 });
            const m = await showForm(player, modal);
            if (m && !m.canceled) {
                const name = list[m.formValues[0]];
                if (name && removeBan(name)) player.sendMessage(`§e[Anticheat]§r §a${name}§r has been §aunbanned§r.`);
            }
            break;
        }
        case 1: {
            const modal = new ModalFormData().title("Ban a Player").textField("Player name", "Exact name");
            const m = await showForm(player, modal);
            if (m && !m.canceled) {
                const name = (m.formValues[0] || "").trim();
                if (!name) { player.sendMessage("§e[Anticheat]§c No name entered."); break; }
                let target = null;
                for (const p of world.getPlayers()) { if (p.name === name) { target = p; break; } }
                if (target && target.hasTag("admin")) { player.sendMessage("§e[Anticheat]§c You cannot ban an admin."); break; }
                addBan(name);
                if (target) kickPlayer(target, "Anticheat: you are banned from this world");
                player.sendMessage(`§e[Anticheat]§r §c${name}§r has been §cbanned§r${target ? " and kicked" : " (will be kicked on join)"}.`);
            }
            break;
        }
        default:
            await openMainMenu(player);
    }
}

// --- ILLEGAL ITEMS DEFINITION ---
const ILLEGAL_ITEMS = new Set([
    "minecraft:command_block", "minecraft:chain_command_block", "minecraft:repeating_command_block",
    "minecraft:barrier", "minecraft:structure_block", "minecraft:structure_void",
    "minecraft:light_block", "minecraft:border_block", "minecraft:allow",
    "minecraft:deny", "minecraft:jigsaw", "minecraft:debug_stick"
]);

function isIllegalItem(item) {
    if (!item) return false;
    if (isWhitelisted(item.typeId)) return false;
    return ILLEGAL_ITEMS.has(item.typeId) || item.typeId.includes("_spawn_egg");
}

// --- NEARBY CONTAINER SCANNING ---
// A single cube sweep per player handles BOTH bundle/shulker blocking and
// illegal-item removal, so we only fetch each nearby block once (previously
// two independent O(radius^3) sweeps ran on separate intervals).
const SCAN_RADIUS = 6;

// Containers a bundle/shulker exploit can be funneled through.
function isBundleScanContainer(typeId) {
    return typeId === "minecraft:hopper" || typeId === "minecraft:dispenser" || typeId === "minecraft:dropper";
}

// Containers that should be swept for illegal items. Uses endsWith for shulker
// boxes so every dye colour is covered, and explicitly excludes the ender chest
// (which has no shared inventory and must never be touched).
function isIllegalScanContainer(typeId) {
    if (typeId === "minecraft:ender_chest") return false;
    if (typeId.endsWith("shulker_box")) return true;
    return typeId === "minecraft:chest" || typeId === "minecraft:trapped_chest" ||
        typeId === "minecraft:barrel" || typeId === "minecraft:hopper" ||
        typeId === "minecraft:dispenser" || typeId === "minecraft:dropper";
}

function handleBundleContainer(container, block, player, dimension) {
    for (let slot = 0; slot < container.size; slot++) {
        const item = container.getItem(slot);
        const typeId = item?.typeId;
        if (!typeId) continue;
        const isBundle = typeId.includes("bundle");
        const isShulkerBox = typeId.includes("shulker_box");
        if (isBundle || isShulkerBox) {
            container.setItem(slot, undefined);
            const exploitName = isBundle ? "Bundle" : "Shulker Box";
            broadcastAlert(`Illegal ${exploitName} transaction blocked at ${Math.floor(block.location.x)}, ${Math.floor(block.location.z)}!`);
            recordDupeAttempt(player);
            recordDupeHistory(player.name, `${exploitName} Exploit`, player.dimension.id);
            for (const p of dimension.getPlayers({ location: block.location, maxDistance: 16 })) {
                p.playSound("note.bass", { pitch: 0.5, volume: 1 });
            }
            break;
        }
    }
}

function handleIllegalContainer(container, player) {
    for (let slot = 0; slot < container.size; slot++) {
        const item = container.getItem(slot);
        if (isIllegalItem(item)) {
            container.setItem(slot, undefined);
            const itemName = item.typeId.replace("minecraft:", "");
            broadcastAlert(`§fAn illegal item was found in a container near §e${player.name}§f and removed: §c${itemName}§f!`);
            recordDupeHistory(player.name, `Illegal Item Found Nearby in Container: ${itemName}`, player.dimension.id);
        }
    }
}

function scanNearbyContainers() {
    const bundleOn = getBundleBlockingSetting();
    const illegalOn = getIllegalItemsSetting();
    const pistonOn = getPistonProtectionSetting();
    if (!bundleOn && !illegalOn && !pistonOn) return;

    for (const player of world.getPlayers()) {
        try {
            const isAdmin = player.hasTag("admin");
            // Admins bypass illegal-item sweeping; bundle/piston protection applies to everyone.
            const scanIllegal = illegalOn && !isAdmin;
            if (!bundleOn && !scanIllegal && !pistonOn) continue;

            const pos = player.location;
            const dimension = player.dimension;
            const baseX = Math.floor(pos.x), baseY = Math.floor(pos.y), baseZ = Math.floor(pos.z);
            for (let dx = -SCAN_RADIUS; dx <= SCAN_RADIUS; dx++) {
                for (let dy = -SCAN_RADIUS; dy <= SCAN_RADIUS; dy++) {
                    for (let dz = -SCAN_RADIUS; dz <= SCAN_RADIUS; dz++) {
                        try {
                            const block = dimension.getBlock({ x: baseX + dx, y: baseY + dy, z: baseZ + dz });
                            if (!block) continue;
                            const typeId = block.typeId;
                            if (pistonOn && isPistonType(typeId)) { checkPistonSetup(block, dimension); continue; }
                            const doBundle = bundleOn && isBundleScanContainer(typeId);
                            const doIllegal = scanIllegal && isIllegalScanContainer(typeId);
                            if (!doBundle && !doIllegal) continue;
                            const container = block.getComponent("inventory")?.container;
                            if (!container) continue;
                            if (doBundle) handleBundleContainer(container, block, player, dimension);
                            if (doIllegal) handleIllegalContainer(container, player);
                        } catch (e) {}
                    }
                }
            }
        } catch (e) {}
    }
}

system.runInterval(scanNearbyContainers, 10);

// Block bundles/shulkers being inserted into crafters via beforeEvents
world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    if (!getBundleBlockingSetting()) return;
    const block = event.block;
    if (block.typeId !== "minecraft:crafter") return;
    const player = event.player;
    const item = event.itemStack;
    if (!item) return;
    const isBundle = item.typeId.includes("bundle");
    const isShulkerBox = item.typeId.includes("shulker_box");
    if (!isBundle && !isShulkerBox) return;
    event.cancel = true;
    const exploitName = isBundle ? "Bundle" : "Shulker Box";
    system.run(() => {
        broadcastAlert(`Illegal ${exploitName} transaction blocked at ${Math.floor(block.location.x)}, ${Math.floor(block.location.z)}!`);
        recordDupeAttempt(player);
        recordDupeHistory(player.name, `${exploitName} Exploit`, player.dimension.id);
        for (const p of player.dimension.getPlayers({ location: block.location, maxDistance: 16 })) {
            p.playSound("note.bass", { pitch: 0.5, volume: 1 });
        }
    });
});

// --- INVENTORY SYNC ---
function getPlayerInventoryMap(player) {
    const counts = {};
    const inventory = player.getComponent("inventory")?.container;
    if (inventory) {
        for (let i = 0; i < inventory.size; i++) {
            const item = inventory.getItem(i);
            if (item) counts[item.typeId] = (counts[item.typeId] || 0) + item.amount;
        }
    }
    return counts;
}

function totalItems(counts) {
    let total = 0;
    for (const id in counts) total += counts[id];
    return total;
}

// Snapshot the player's live inventory. Written continuously so the most recent
// snapshot reflects what they legitimately held before a disconnect. Undebounced
// so the baseline always matches the real online inventory.
//
// Teleport / chunk-reload hardening: while a player is being reloaded (a TP mod,
// dimension change, or the chunk streaming back in) the inventory can briefly
// read EMPTY or PARTIAL. If that transient read were saved as the baseline, the
// player's real items would look like a surplus "dupe" moments later and get
// deleted. So we never let a suspicious shrink overwrite a good snapshot: a
// stale-but-higher baseline is safe (it can only miss a dupe, never invent one),
// whereas a too-low baseline is exactly what fabricates false positives.
function savePlayerInventory(player) {
    if (!getInventorySyncSetting()) return;
    try {
        const container = player.getComponent("inventory")?.container;
        if (!container) return; // entity mid-reload; not safe to snapshot
        const currentCounts = getPlayerInventoryMap(player);
        const total = totalItems(currentCounts);
        const prevRaw = world.getDynamicProperty(`dp_inv_${player.id}`);
        if (prevRaw) {
            const prevTotal = totalItems(JSON.parse(prevRaw));
            // Empty read over a non-empty baseline, or a drastic (>50%) shrink,
            // is almost always a transient reload rather than a real change.
            if (prevTotal > 0 && total === 0) return;
            if (prevTotal > 0 && total < prevTotal * 0.5) return;
        }
        world.setDynamicProperty(`dp_inv_${player.id}`, JSON.stringify(currentCounts));
    } catch (e) {}
}

// Once per second is plenty to keep a fresh pre-disconnect snapshot, and it
// avoids writing a dynamic property several times per second per player.
system.runInterval(() => {
    if (!getInventorySyncSetting()) return;
    for (const player of world.getPlayers()) savePlayerInventory(player);
}, 20);

function runSpawnCheck(player) {
    try {
        if (!player || player.isValid === false) return;
        const savedStr = world.getDynamicProperty(`dp_inv_${player.id}`);
        if (!savedStr) return;
        const savedMap = JSON.parse(savedStr);
        // No trustworthy baseline to compare against -> never flag.
        if (totalItems(savedMap) === 0) return;
        const container = player.getComponent("inventory")?.container;
        if (!container) return; // still loading; re-checking later is safe
        const currentMap = getPlayerInventoryMap(player);
        let detectedDupe = false;
        for (const typeId in currentMap) {
            const currentCount = currentMap[typeId];
            const savedCount = savedMap[typeId] || 0;
            if (currentCount > savedCount) {
                detectedDupe = true;
                const itemName = typeId.replace("minecraft:", "");
                const removeItems = getInventorySyncRemoveSetting();
                broadcastAlert(`§e${player.name} §ftried to sync duplicated §7${itemName}§f!${removeItems ? " Items removed." : ""}`);
                recordDupeAttempt(player, false); // low-confidence: log only, never auto-punish
                recordDupeHistory(player.name, `Inventory Sync Exploit (${itemName} x${currentCount - savedCount})`, player.dimension.id);
                if (removeItems) {
                    let toRemove = currentCount - savedCount;
                    for (let i = 0; i < container.size; i++) {
                        if (toRemove <= 0) break;
                        const item = container.getItem(i);
                        if (item?.typeId === typeId) {
                            if (item.amount > toRemove) {
                                item.amount -= toRemove;
                                container.setItem(i, item);
                                toRemove = 0;
                            } else {
                                toRemove -= item.amount;
                                container.setItem(i);
                            }
                        }
                    }
                }
            }
        }
        if (detectedDupe) player.playSound("note.bass", { pitch: 0.5, volume: 1 });
    } catch (e) { console.warn(`Inv check error: ${e}`); }
}

world.afterEvents.playerSpawn.subscribe((event) => {
    if (!getInventorySyncSetting()) return;
    // Only check on an actual join/rejoin. Death-respawns and other spawns are
    // normal play — checking them turns legitimate item pickups into false
    // "dupe" removals. The inventory-sync exploit can only add items while the
    // player is OFFLINE, so a rejoin is the only moment worth comparing.
    if (!event.initialSpawn) return;
    const player = event.player;
    system.runTimeout(() => runSpawnCheck(player), 40);
});

// --- ILLEGAL ITEMS: PLAYER INVENTORY SCAN ---
function scanPlayerForIllegalItems(player) {
    if (!getIllegalItemsSetting()) return;
    if (player.hasTag("admin")) return;
    try {
        const container = player.getComponent("inventory")?.container;
        if (!container) return;
        for (let i = 0; i < container.size; i++) {
            const item = container.getItem(i);
            if (isIllegalItem(item)) {
                container.setItem(i, undefined);
                const itemName = item.typeId.replace("minecraft:", "");
                broadcastAlert(`§e${player.name} §fhad an illegal item removed: §c${itemName}§f!`);
                recordDupeAttempt(player);
                recordDupeHistory(player.name, `Illegal Item: ${itemName}`, player.dimension.id);
                player.playSound("note.bass", { pitch: 0.5, volume: 1 });
            }
        }
    } catch (e) {}
}

system.runInterval(() => {
    if (!getIllegalItemsSetting()) return;
    for (const player of world.getPlayers()) scanPlayerForIllegalItems(player);
}, 20);

// --- BANNED BLOCK PLACEMENT ---
const BANNED_BLOCKS = new Set([
    "minecraft:command_block", "minecraft:chain_command_block", "minecraft:repeating_command_block"
]);

world.afterEvents.playerPlaceBlock.subscribe((event) => {
    if (!getBannedBlocksSetting()) return;
    const player = event.player;
    if (player.hasTag("admin")) return;
    const block = event.block;
    if (!BANNED_BLOCKS.has(block.typeId)) return;
    try {
        const blockName = block.typeId.replace("minecraft:", "");
        block.dimension.setBlockType(block.location, "minecraft:air");
        broadcastAlert(`§e${player.name} §fplaced a banned block (§c${blockName}§f) - it has been removed!`);
        recordDupeAttempt(player);
        recordDupeHistory(player.name, `Banned Block Placed: ${blockName}`, player.dimension.id);
        player.playSound("note.bass", { pitch: 0.5, volume: 1 });
    } catch (e) { console.warn(`[Anticheat] Failed to remove banned block: ${e}`); }
});

// --- BEDROCK BREAK PROTECTION ---
world.beforeEvents.playerBreakBlock.subscribe((event) => {
    if (!getBedrockProtectionSetting()) return;
    if (event.block.typeId !== "minecraft:bedrock") return;
    if (event.player.hasTag("admin")) return;
    event.cancel = true;
    const player = event.player;
    system.run(() => {
        broadcastAlert(`§e${player.name} §ftried to break §cbedrock§f!`);
        recordDupeAttempt(player);
        recordDupeHistory(player.name, "Attempted Bedrock Break", player.dimension.id);
        player.playSound("note.bass", { pitch: 0.5, volume: 1 });
    });
});

// --- MINECART CHEST DUPE DETECTION ---
const recentMinecartBreaks = new Map();

world.afterEvents.entityRemove.subscribe((event) => {
    if (!getMinecartProtectionSetting()) return;
    if (!event.typeId?.includes("chest_minecart")) return;
    const pos = event.location;
    if (!pos) return;
    const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
    const now = Date.now();
    const last = recentMinecartBreaks.get(key);
    if (last && now - last < 3000) {
        for (const player of world.getPlayers({ location: pos, maxDistance: 8 })) {
            if (player.hasTag("admin")) continue;
            broadcastAlert(`§e${player.name} §fmay be attempting a §cminecart chest dupe§f!`);
            recordDupeAttempt(player);
            recordDupeHistory(player.name, "Suspected Minecart Chest Dupe", player.dimension.id);
        }
    }
    recentMinecartBreaks.set(key, now);
    system.runTimeout(() => recentMinecartBreaks.delete(key), 5000);
});

// --- PISTON CONTAINER DUPE PROTECTION ---
// Pushing a container block-entity (shulker box / chest / barrel) with a piston
// is a known Bedrock duplication glitch. We break the setup by popping the
// PISTON off (returned as an item so no block is lost) — never the container or
// its contents, so a false positive costs at most one piston.
//
// The glitch has many geometric variants: the container directly in front, a
// block (e.g. a lightning rod) pushed INTO the container, or the container
// offset a block from the piston/pushed block. So rather than match one shape,
// we (1) catch the obvious "piston aimed straight at a container" at placement
// time with correct attribution, and (2) continuously sweep every piston near a
// player, tracing its full push line and checking for adjacent shulkers, and pop
// any piston that could move a container. The sweep can't reliably attribute to
// a builder, so it only removes + alerts; the placement path is what escalates.
function isPistonDupeContainer(typeId) {
    if (!typeId) return false;
    if (typeId.endsWith("shulker_box")) return true;
    return typeId === "minecraft:chest" || typeId === "minecraft:trapped_chest" || typeId === "minecraft:barrel";
}

function isPistonType(typeId) {
    return typeId === "minecraft:piston" || typeId === "minecraft:sticky_piston";
}

// Blocks a piston physically cannot push past — stop tracing the push line here.
function isImmovableForPiston(typeId) {
    return typeId === "minecraft:air" || typeId === "minecraft:obsidian" ||
        typeId === "minecraft:bedrock" || typeId === "minecraft:barrier" ||
        isPistonType(typeId);
}

// facing_direction (legacy integer) -> the offset the piston pushes toward.
const PISTON_FACING_OFFSETS = {
    0: { x: 0, y: -1, z: 0 }, 1: { x: 0, y: 1, z: 0 },
    2: { x: 0, y: 0, z: -1 }, 3: { x: 0, y: 0, z: 1 },
    4: { x: -1, y: 0, z: 0 }, 5: { x: 1, y: 0, z: 0 },
};
// minecraft:facing_direction (newer string trait) -> same offsets.
const FACING_STRING_OFFSETS = {
    down: { x: 0, y: -1, z: 0 }, up: { x: 0, y: 1, z: 0 },
    north: { x: 0, y: 0, z: -1 }, south: { x: 0, y: 0, z: 1 },
    west: { x: -1, y: 0, z: 0 }, east: { x: 1, y: 0, z: 0 },
};

// Read a piston's push direction. Different versions/blocks expose it as either
// the legacy integer `facing_direction` or the string `minecraft:facing_direction`,
// so try both before giving up.
function pistonFacingOffset(pistonBlock) {
    try {
        const perm = pistonBlock.permutation;
        const f = perm.getState("facing_direction");
        if (f !== undefined && f !== null && PISTON_FACING_OFFSETS[f]) return PISTON_FACING_OFFSETS[f];
        const s = perm.getState("minecraft:facing_direction");
        if (typeof s === "string" && FACING_STRING_OFFSETS[s]) return FACING_STRING_OFFSETS[s];
        return null;
    } catch (e) { return null; }
}

// Pop a piston that is set up to push a container, returning it as an item.
// A player is passed only when we can attribute it (placement); the sweep passes
// null and only removes + alerts, to avoid escalating the wrong nearby player.
function neutralizePistonSetup(pistonBlock, containerName, player) {
    try {
        const dimension = pistonBlock.dimension;
        const loc = { x: pistonBlock.location.x, y: pistonBlock.location.y, z: pistonBlock.location.z };
        const pistonType = pistonBlock.typeId;
        dimension.setBlockType(loc, "minecraft:air");
        try { dimension.spawnItem(new ItemStack(pistonType, 1), { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 }); } catch (e) {}
        broadcastAlert(`§fA §cpiston ${containerName} dupe§f was blocked at ${Math.floor(loc.x)}, ${Math.floor(loc.z)}!`);
        if (player) {
            recordDupeAttempt(player);
            recordDupeHistory(player.name, `Piston Dupe: ${containerName}`, player.dimension.id);
        }
        for (const p of dimension.getPlayers({ location: loc, maxDistance: 16 })) {
            try { p.playSound("note.bass", { pitch: 0.5, volume: 1 }); } catch (e) {}
        }
    } catch (e) {}
}

// True if any of the 6 blocks touching (x,y,z) is a shulker box.
function hasAdjacentShulker(dimension, x, y, z) {
    const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (const [dx, dy, dz] of dirs) {
        try {
            const b = dimension.getBlock({ x: x + dx, y: y + dy, z: z + dz });
            if (b && b.typeId.endsWith("shulker_box")) return true;
        } catch (e) {}
    }
    return false;
}

// Sweep check (called for each piston found near a player). Reading the piston's
// facing proved unreliable across versions, so we use position, not direction: a
// shulker touching the piston on ANY side pops it (a shulker next to a piston is
// virtually never a legit build). We still trace the push line as a bonus so a
// container behind a pushed block (e.g. a lightning rod), or a chest/barrel in
// the push path, is caught too.
function checkPistonSetup(pistonBlock, dimension) {
    try {
        const px = pistonBlock.location.x, py = pistonBlock.location.y, pz = pistonBlock.location.z;
        if (hasAdjacentShulker(dimension, px, py, pz)) { neutralizePistonSetup(pistonBlock, "shulker_box", null); return; }
        const off = pistonFacingOffset(pistonBlock);
        if (!off) return; // push-line bonus needs facing; adjacency above already ran
        for (let i = 1; i <= 12; i++) {
            const cx = px + off.x * i, cy = py + off.y * i, cz = pz + off.z * i;
            const b = dimension.getBlock({ x: cx, y: cy, z: cz });
            if (!b) return;
            const t = b.typeId;
            if (isPistonDupeContainer(t)) { neutralizePistonSetup(pistonBlock, t.replace("minecraft:", ""), null); return; }
            if (hasAdjacentShulker(dimension, cx, cy, cz)) { neutralizePistonSetup(pistonBlock, "shulker_box", null); return; }
            if (isImmovableForPiston(t)) return; // air/obsidian/gap — nothing pushed past here
        }
    } catch (e) {}
}

// Placement detector: catch the obvious "piston aimed straight at a container"
// setup the moment it is built, attributed to (and escalating) the placer.
world.afterEvents.playerPlaceBlock.subscribe((event) => {
    if (!getPistonProtectionSetting()) return;
    try {
        const player = event.player;
        const block = event.block;
        const dimension = block.dimension;
        if (isPistonType(block.typeId)) {
            const off = pistonFacingOffset(block);
            if (!off) return;
            const front = dimension.getBlock({ x: block.location.x + off.x, y: block.location.y + off.y, z: block.location.z + off.z });
            if (front && isPistonDupeContainer(front.typeId)) {
                const name = front.typeId.replace("minecraft:", "");
                system.run(() => neutralizePistonSetup(block, name, player));
            }
        } else if (isPistonDupeContainer(block.typeId)) {
            for (const key in PISTON_FACING_OFFSETS) {
                const o = PISTON_FACING_OFFSETS[key];
                const nb = dimension.getBlock({ x: block.location.x - o.x, y: block.location.y - o.y, z: block.location.z - o.z });
                if (nb && isPistonType(nb.typeId)) {
                    const nbOff = pistonFacingOffset(nb);
                    if (nbOff && nbOff.x === o.x && nbOff.y === o.y && nbOff.z === o.z) {
                        const name = block.typeId.replace("minecraft:", "");
                        system.run(() => neutralizePistonSetup(nb, name, player));
                        break;
                    }
                }
            }
        }
    } catch (e) {}
});

// --- DUPED-CONTAINER-ITEM CLEANUP ---
// Geometry-independent safety net: when a piston dupe fires it drops the extra
// container as an item entity. If two or more of the SAME container item appear
// at the same spot next to a piston within ~1s, the extras are the duped copies
// — delete them (keeping one). Scoped to piston-adjacent drops so ordinary
// shulker drops from breaking/dropping are never touched.
const recentContainerDrops = new Map(); // "x,y,z" -> count within the window

function pistonWithin(dimension, loc, radius) {
    const bx = Math.floor(loc.x), by = Math.floor(loc.y), bz = Math.floor(loc.z);
    for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dz = -radius; dz <= radius; dz++) {
                try {
                    const b = dimension.getBlock({ x: bx + dx, y: by + dy, z: bz + dz });
                    if (b && isPistonType(b.typeId)) return true;
                } catch (e) {}
            }
        }
    }
    return false;
}

world.afterEvents.entitySpawn.subscribe((event) => {
    if (!getPistonProtectionSetting()) return;
    try {
        const ent = event.entity;
        if (!ent || ent.typeId !== "minecraft:item") return;
        const stack = ent.getComponent("minecraft:item")?.itemStack;
        if (!stack || !isPistonDupeContainer(stack.typeId)) return;
        const dimension = ent.dimension;
        const loc = ent.location;
        if (!pistonWithin(dimension, loc, 3)) return; // only near a piston
        const key = `${Math.floor(loc.x)},${Math.floor(loc.y)},${Math.floor(loc.z)}`;
        const count = (recentContainerDrops.get(key) || 0) + 1;
        recentContainerDrops.set(key, count);
        if (count === 1) {
            // First copy is the legitimate one; keep it, and start the window.
            system.runTimeout(() => recentContainerDrops.delete(key), 20);
            return;
        }
        // Second+ identical container item at this spot near a piston = duped.
        system.run(() => {
            try { ent.remove(); } catch (e) {}
            broadcastAlert(`§fA §cpiston ${stack.typeId.replace("minecraft:", "")} dupe§f was cleaned up at ${Math.floor(loc.x)}, ${Math.floor(loc.z)}!`);
        });
    } catch (e) {}
});

// --- NETHER PORTAL ITEM DUPE PROTECTION ---
// Tossing a container as a dropped item into a nether portal and force-quitting
// duplicates it: the item transfers to the nether while the force-quit rolls the
// inventory back to still holding it. The force-quit is invisible to scripts, so
// we deny the vector — a container item sitting in a nether portal is removed
// before it can transfer, so the nether copy never exists. Container items are
// essentially never tossed through portals in normal play (you carry them).
function scanPortalItems() {
    if (!getPortalProtectionSetting()) return;
    for (const player of world.getPlayers()) {
        const dimension = player.dimension;
        let items;
        try { items = dimension.getEntities({ type: "minecraft:item", location: player.location, maxDistance: 16 }); }
        catch (e) { continue; }
        for (const ent of items) {
            try {
                const stack = ent.getComponent("minecraft:item")?.itemStack;
                if (!stack || !isPistonDupeContainer(stack.typeId)) continue;
                const block = dimension.getBlock(ent.location);
                if (!block || block.typeId !== "minecraft:portal") continue; // nether portal block
                const loc = { x: ent.location.x, y: ent.location.y, z: ent.location.z };
                const name = stack.typeId.replace("minecraft:", "");
                ent.remove();
                broadcastAlert(`§fA §c${name} nether-portal dupe§f was blocked at ${Math.floor(loc.x)}, ${Math.floor(loc.z)}!`);
                recordDupeHistory(player.name, `Nether Portal Dupe: ${name}`, player.dimension.id);
                for (const p of dimension.getPlayers({ location: loc, maxDistance: 16 })) {
                    try { p.playSound("note.bass", { pitch: 0.5, volume: 1 }); } catch (e) {}
                }
            } catch (e) {}
        }
    }
}

system.runInterval(scanPortalItems, 5);
