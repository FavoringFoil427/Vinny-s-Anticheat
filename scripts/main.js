import { world, system, CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { ActionFormData, ModalFormData, MessageFormData, FormCancelationReason } from "@minecraft/server-ui";

console.warn("[Vinny's Anticheat] Script loading...");

// --- DUPE LOG SCOREBOARD ---
const DUPE_LOG_OBJECTIVE = "dupe_log";
const DUPE_HISTORY_PROPERTY = "cheats:dupeHistory";
const MAX_HISTORY_PER_PLAYER = 5;
const ITEM_WHITELIST_PROPERTY = "cheats:itemWhitelist";

function ensureDupeLogObjective() {
    try {
        const existing = world.scoreboard.getObjective(DUPE_LOG_OBJECTIVE);
        if (!existing) world.scoreboard.addObjective(DUPE_LOG_OBJECTIVE, "dummy");
    } catch (e) {
        try { world.scoreboard.addObjective(DUPE_LOG_OBJECTIVE, "dummy"); } catch (e2) {}
    }
}

function recordDupeAttempt(player) {
    try {
        ensureDupeLogObjective();
        const objective = world.scoreboard.getObjective(DUPE_LOG_OBJECTIVE);
        if (!objective) return;
        let current = 0;
        try { current = objective.getScore(player.name) ?? 0; } catch (e) {}
        objective.setScore(player.name, current + 1);
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
    world.sendMessage(`§l§e[Anticheat] §c§lALERT: §f${message}`);
}

// --- SETTINGS ---
const BUNDLE_BLOCK_PROPERTY = "cheats:blockBundles";
const INVENTORY_SYNC_PROPERTY = "cheats:inventorySync";
const ILLEGAL_ITEMS_PROPERTY = "cheats:illegalItems";
const BANNED_BLOCKS_PROPERTY = "cheats:bannedBlocks";
const BEDROCK_PROTECTION_PROPERTY = "cheats:bedrockProtection";
const MINECART_PROTECTION_PROPERTY = "cheats:minecartProtection";

function getBundleBlockingSetting() { return world.getDynamicProperty(BUNDLE_BLOCK_PROPERTY) ?? true; }
function setBundleBlockingSetting(v) { world.setDynamicProperty(BUNDLE_BLOCK_PROPERTY, v); }
function getInventorySyncSetting() { return world.getDynamicProperty(INVENTORY_SYNC_PROPERTY) ?? false; }
function setInventorySyncSetting(v) { world.setDynamicProperty(INVENTORY_SYNC_PROPERTY, v); }
function getIllegalItemsSetting() { return world.getDynamicProperty(ILLEGAL_ITEMS_PROPERTY) ?? true; }
function setIllegalItemsSetting(v) { world.setDynamicProperty(ILLEGAL_ITEMS_PROPERTY, v); }
function getBannedBlocksSetting() { return world.getDynamicProperty(BANNED_BLOCKS_PROPERTY) ?? true; }
function setBannedBlocksSetting(v) { world.setDynamicProperty(BANNED_BLOCKS_PROPERTY, v); }
function getBedrockProtectionSetting() { return world.getDynamicProperty(BEDROCK_PROTECTION_PROPERTY) ?? true; }
function setBedrockProtectionSetting(v) { world.setDynamicProperty(BEDROCK_PROTECTION_PROPERTY, v); }
function getMinecartProtectionSetting() { return world.getDynamicProperty(MINECART_PROTECTION_PROPERTY) ?? true; }
function setMinecartProtectionSetting(v) { world.setDynamicProperty(MINECART_PROTECTION_PROPERTY, v); }

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
                msg += `  §f/cheats:illegalitems §7- Toggle Illegal Item Detection\n`;
                msg += `  §f/cheats:bannedblocks §7- Toggle Banned Block Detection\n`;
                msg += `  §f/cheats:bedrock §7- Toggle Bedrock Break Protection\n`;
                msg += `  §f/cheats:minecart §7- Toggle Minecart Chest Dupe Detection\n`;
                msg += `\n§aInfo:§r\n`;
                msg += `  §f/cheats:ui §7- Open the control panel (operators)\n`;
                msg += `  §f/cheats:status §7- View all toggle states\n`;
                msg += `  §f/cheats:help §7- Show this list\n`;
                if (isAdmin) {
                    msg += `\n§aAdmin §7(requires admin tag):§r\n`;
                    msg += `  §f/cheats:viewlog §7- View the dupe log\n`;
                    msg += `  §f/cheats:history <player> §7- View a player's history\n`;
                    msg += `  §f/cheats:clearlog [player] §7- Clear the dupe log\n`;
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
                    `  Inventory Sync: ${getInventorySyncSetting() ? "§aENABLED" : "§cDISABLED"}§r\n` +
                    `  Illegal Item Detection: ${getIllegalItemsSetting() ? "§aENABLED" : "§cDISABLED"}§r\n` +
                    `  Banned Block Detection: ${getBannedBlocksSetting() ? "§aENABLED" : "§cDISABLED"}§r\n` +
                    `  Bedrock Break Protection: ${getBedrockProtectionSetting() ? "§aENABLED" : "§cDISABLED"}§r\n` +
                    `  Minecart Chest Dupe Detection: ${getMinecartProtectionSetting() ? "§aENABLED" : "§cDISABLED"}§r\n`
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
        { name: "cheats:ui", description: "Open the Anticheat control panel", permissionLevel: CommandPermissionLevel.GameDirectors },
        (origin) => {
            const player = origin.sourceEntity;
            if (!player || player.typeId !== "minecraft:player") return { status: 0 };
            // Forms cannot be shown from the read-only command context, so defer
            // to the next tick. openMainMenu retries past the initial "UserBusy".
            system.run(() => {
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
    form.button("Protection Toggles");
    actions.push(openTogglesMenu);
    if (isAdmin) {
        form.button("Dupe Log");        actions.push(openDupeLogMenu);
        form.button("Player History");  actions.push(openHistoryPrompt);
        form.button("Clear Log");       actions.push(openClearLogMenu);
        form.button("Whitelist");       actions.push(openWhitelistMenu);
    }
    const res = await showForm(player, form);
    if (!res || res.canceled) return;
    const handler = actions[res.selection];
    if (handler) await handler(player);
}

async function openTogglesMenu(player) {
    const form = new ModalFormData()
        .title("Protection Toggles")
        .toggle("Bundle/Shulker Box Blocking", getBundleBlockingSetting())
        .toggle("Inventory Sync", getInventorySyncSetting())
        .toggle("Illegal Item Detection", getIllegalItemsSetting())
        .toggle("Banned Block Detection", getBannedBlocksSetting())
        .toggle("Bedrock Break Protection", getBedrockProtectionSetting())
        .toggle("Minecart Chest Dupe Detection", getMinecartProtectionSetting());
    const res = await showForm(player, form);
    if (!res || res.canceled) return;
    const v = res.formValues;
    setBundleBlockingSetting(!!v[0]);
    setInventorySyncSetting(!!v[1]);
    setIllegalItemsSetting(!!v[2]);
    setBannedBlocksSetting(!!v[3]);
    setBedrockProtectionSetting(!!v[4]);
    setMinecartProtectionSetting(!!v[5]);
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
    const form = new ActionFormData().title(`History: ${name}`).body(body).button("Back");
    const r = await showForm(player, form);
    if (r && !r.canceled) await openMainMenu(player);
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
            const modal = new ModalFormData().title("Remove from Whitelist").dropdown("Select item", list, 0);
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
    if (!bundleOn && !illegalOn) return;

    for (const player of world.getPlayers()) {
        try {
            const isAdmin = player.hasTag("admin");
            // Admins bypass illegal-item sweeping; bundle blocking applies to everyone.
            const scanIllegal = illegalOn && !isAdmin;
            if (!bundleOn && !scanIllegal) continue;

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

const pendingUpdates = new Map();
const lastCommittedCounts = new Map();

function savePlayerInventory(player) {
    if (!getInventorySyncSetting()) return;
    try {
        const currentCounts = getPlayerInventoryMap(player);
        const playerId = player.id;
        if (!lastCommittedCounts.has(playerId)) {
            const stored = world.getDynamicProperty(`dp_inv_${playerId}`);
            lastCommittedCounts.set(playerId, stored ? JSON.parse(stored) : {});
        }
        const committed = lastCommittedCounts.get(playerId);
        let hasIncrease = false;
        for (const id in currentCounts) {
            if ((currentCounts[id] || 0) > (committed[id] || 0)) { hasIncrease = true; break; }
        }
        if (hasIncrease) {
            let pending = pendingUpdates.get(playerId);
            if (pending && Date.now() - pending.timestamp > 1000) {
                world.setDynamicProperty(`dp_inv_${playerId}`, JSON.stringify(currentCounts));
                lastCommittedCounts.set(playerId, currentCounts);
                pendingUpdates.delete(playerId);
            } else if (!pending) {
                pendingUpdates.set(playerId, { counts: currentCounts, timestamp: Date.now() });
            }
        } else {
            world.setDynamicProperty(`dp_inv_${playerId}`, JSON.stringify(currentCounts));
            lastCommittedCounts.set(playerId, currentCounts);
            pendingUpdates.delete(playerId);
        }
    } catch (e) {}
}

system.runInterval(() => {
    if (!getInventorySyncSetting()) return;
    for (const player of world.getPlayers()) savePlayerInventory(player);
}, 5);

function runSpawnCheck(player) {
    try {
        if (!player || player.isValid === false) return;
        const savedStr = world.getDynamicProperty(`dp_inv_${player.id}`);
        if (!savedStr) return;
        const savedMap = JSON.parse(savedStr);
        const currentMap = getPlayerInventoryMap(player);
        let detectedDupe = false;
        const container = player.getComponent("inventory")?.container;
        if (!container) return;
        for (const typeId in currentMap) {
            const currentCount = currentMap[typeId];
            const savedCount = savedMap[typeId] || 0;
            if (currentCount > savedCount) {
                detectedDupe = true;
                const itemName = typeId.replace("minecraft:", "");
                broadcastAlert(`§e${player.name} §ftried to sync duplicated §7${itemName}§f! Items removed.`);
                recordDupeAttempt(player);
                recordDupeHistory(player.name, `Inventory Sync Exploit (${itemName} x${currentCount - savedCount})`, player.dimension.id);
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
        if (detectedDupe) player.playSound("note.bass", { pitch: 0.5, volume: 1 });
    } catch (e) { console.warn(`Inv check error: ${e}`); }
}

world.afterEvents.playerSpawn.subscribe((event) => {
    if (!getInventorySyncSetting()) return;
    const player = event.player;
    system.runTimeout(() => runSpawnCheck(player), 40);
});

// Drop per-player runtime caches when a player leaves so the Maps don't grow
// unbounded. The persisted dp_inv_<id> property is intentionally kept so the
// relog dupe check still has a baseline to compare against on rejoin.
world.afterEvents.playerLeave.subscribe((event) => {
    lastCommittedCounts.delete(event.playerId);
    pendingUpdates.delete(event.playerId);
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
