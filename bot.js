const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot aktif!\n');
});
server.listen(process.env.PORT || 3000, () => {
  console.log('[System] Web sunucusu baslatildi, Render kapanmayacak.');
});


/**
 * A human-like Mineflayer AFK bot designed to keep Minecraft servers alive
 * by simulating real player behavior, including movement, interaction, and chat responses.
 * * This bot is configured via 'config.json' and includes features like:
 * - Auto-reconnect (with different delays for server offline vs. in-game disconnects)
 * - Connection timeout watchdog
 * - A wide range of random "human-like" actions (walking, looking, jumping, etc.)
 * - Social interaction (responds to chat mentions)
 */

// --- 1. IMPORTS ---

const mineflayer = require('mineflayer');
const config = require('./config.json'); // Load bot configuration
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { GoalNearXZ } = goals;

// --- 2. CONSTANTS ---

// Reconnect delay for in-game disconnects (e.g., kicked, connection lost)
const RECONNECT_DELAY = 10000;      // 10 seconds

// Reconnect delay for initial connection failures (e.g., server is offline)
const RECONNECT_FAIL_DELAY = 120000; // 5 minutes

// Time to wait for a server tick before assuming a frozen connection
const WATCHDOG_TIMEOUT = 45000;    // 45 seconds

// Proactive reconnect timer to simulate a player taking a break.
// 3 hours = 3 * 60 * 60 * 1000 = 10,800,000 milliseconds
const SESSION_DURATION = 10800000; // 3 hours

// --- 3. GLOBAL HELPER ---

/**
 * Generates a random integer within a specified range.
 * @param {number} min - The minimum value (inclusive).
 * @param {number} max - The maximum value (inclusive).
 * @returns {number} A random integer.
 */
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// --- 4. MAIN BOT FUNCTION ---

/**
 * The main function that creates a bot instance and attaches all its logic.
 * This function will recursively call itself to handle reconnects.
 */
function createAndRunBot() {
  console.log('[System] Attempting to connect to server...');

  // --- State Variables ---
  // These are reset every time a new bot instance is created.
  
  // Tracks if the bot has ever spawned in the world.
  // This is crucial for the 10-sec vs 5-min reconnect logic.
  let hasSuccessfullySpawned = false; 

  // Prevents duplicate reconnect logic from 'error' and 'end' firing simultaneously.
  let isDisconnecting = false;
  
  // Tracks the bot's current state for action toggling.
  let isSneaking = false;
  
  // Timestamp for chat reply cooldown to prevent spam.
  let lastChatReply = 0;
  
  // Timer object for the connection watchdog.
  let watchdogTimer = null;

  // --- Bot Initialization ---
  
  const bot = mineflayer.createBot({
    host: config.serverHost,
    port: config.serverPort,
    username: config.botUsername,
    auth: 'offline',

    // IMPORTANT: We MUST specify the version manually.
    // Aternos and other servers often fail auto-detection ('version: false'), 
    // causing a '-1' protocol error. This is read from config.json.
    version: config.serverVersion,
    
    viewDistance: config.viewDistance || 'normal',
    
    // This helps mineflayer's internal timeout detection.
    checkTimeoutInterval: WATCHDOG_TIMEOUT 
  });

  // --- Plugin Loading ---
  
  bot.loadPlugin(pathfinder);

  // --- Internal Helper Functions ---

  /**
   * (Watchdog) Resets the timeout timer.
   * This is called on every 'physicTick', proving the connection is alive.
   */
  function resetWatchdog() {
    if (watchdogTimer) clearTimeout(watchdogTimer);
    watchdogTimer = setTimeout(forceReconnect, WATCHDOG_TIMEOUT);
  }

  /**
   * (Watchdog) Called if the watchdog timer is not reset in time.
   * Forces a disconnect, which will trigger the 'end' event and our reconnect logic.
   */
  function forceReconnect() {
    console.log(`[System] WATCHDOG: No server tick received for ${WATCHDOG_TIMEOUT / 1000}s. Forcing reconnect...`);
    bot.end('watchdog_timeout'); // 'end' event will call handleDisconnect
  }

  /**
   * Unified function to handle all disconnect/error scenarios.
   * This prevents duplicate timers and manages the 10-sec vs 5-min logic.
   * @param {string} reason - The reason for the disconnect.
   */
  function handleDisconnect(reason) {
    // If we are already handling a disconnect, ignore subsequent events.
    if (isDisconnecting) return;
    isDisconnecting = true; // Set flag

    console.log(`⛔️ Bot Disconnected/Failed! Reason: ${reason}`);
    
    if (watchdogTimer) clearTimeout(watchdogTimer); // Stop the watchdog

    // Smart Reconnect Logic:
    if (hasSuccessfullySpawned) {
      // Bot was in-game, so it's a normal disconnect. Reconnect quickly.
      console.log(`Attempting to reconnect in ${RECONNECT_DELAY / 1000} seconds...`);
      setTimeout(createAndRunBot, RECONNECT_DELAY);
    } else {
      // Bot NEVER spawned. Server is likely offline. Reconnect slowly.
      console.log(`[System] Failed to connect (Server offline?). Attempting to reconnect in ${RECONNECT_FAIL_DELAY / 1000 / 60} minutes...`);
      setTimeout(createAndRunBot, RECONNECT_FAIL_DELAY);
    }
  }

  /**
   * The core "human-like" action loop.
   * Selects a random action and performs it, then schedules the next call.
   */
  function performRandomAction() {
    // Safety check in case bot disconnected mid-action
    if (!bot.entity) return; 

    const actionId = randomInt(0, 10); // We have 11 actions (0-10)
    console.log(`[Action] Performing Action ID: ${actionId}`);

    // Stop any pathfinder movement if we're doing a stationary action
    if (actionId !== 5 && bot.pathfinder.isMoving()) {
      console.log(' -> Stopping pathfinder for a stationary action.');
      bot.pathfinder.stop();
    }

    switch (actionId) {
      case 0: // Short Random Movement Burst
        const directions = ['forward', 'back', 'left', 'right'];
        const direction = directions[randomInt(0, 3)];
        const duration = randomInt(100, 300);
        console.log(` -> Moving ${direction} for ${duration}ms`);
        bot.setControlState(direction, true);
        setTimeout(() => { if (bot && bot.entity) { bot.setControlState(direction, false); } }, duration);
        break;

      case 1: // Jump
        console.log(' -> Jumping');
        bot.setControlState('jump', true);
        bot.setControlState('jump', false); // Can be set false immediately
        break;

      case 2: // Look Around
        const yaw = Math.random() * Math.PI * 2 - Math.PI; // Full 360 horizontal
        const pitch = (Math.random()* (Math.PI/2)) - (Math.PI/4); // Realistic vertical
        console.log(' -> Looking around');
        bot.look(yaw, pitch, false);
        break;

      case 3: // "Fake" Mining (Swing arm at nearby block)
        console.log(' -> "Fake" mining a nearby block...');
        const block = bot.findBlock({ matching: (blk) => blk.type !== 0, maxDistance: 3 });
        if (block) {
          bot.lookAt(block.position, false, () => {
            bot.swingArm();
            setTimeout(() => bot.swingArm(), 300);
            setTimeout(() => bot.swingArm(), 600);
          });
        } else { bot.swingArm(); } // Swing at air if no block found
        break;

      case 4: // Toggle Sneak
        isSneaking = !isSneaking;
        console.log(` -> Toggling sneak state: ${isSneaking}`);
        bot.setControlState('sneak', isSneaking);
        break;

      case 5: // Wander (Pathfinder)
        if (bot.pathfinder.isMoving()) {
          console.log(' -> Already wandering, skipping.');
          break; 
        }
        console.log(' -> Wandering to a new location...');
        const pos = bot.entity.position;
        const targetX = pos.x + randomInt(-16, 16);
        const targetZ = pos.z + randomInt(-16, 16);
        const goal = new GoalNearXZ(targetX, targetZ, 2); // 2-block radius tolerance
        bot.pathfinder.setGoal(goal);
        break;

      case 6: // Switch Hotbar Slot
        const newSlot = randomInt(0, 8);
        console.log(` -> Switching hotbar to slot ${newSlot}`);
        bot.setQuickBarSlot(newSlot);
        break;

      case 7: // Look at Nearest Player
        const player = bot.nearestEntity((e) => e.type === 'player' && e.username !== bot.username);
        if (player) {
          console.log(` -> Looking at nearby player: ${player.username}`);
          bot.lookAt(player.position.offset(0, player.height, 0)); // Look at their eyes
        } else {
          console.log(' -> Tried to look at player, but no one is nearby.');
          performRandomAction(); // Do another action instead
          return; // Exit current function call
        }
        break;

      case 8: // Do Nothing (Idle)
        console.log(' -> Idling for a moment...');
        // The setTimeout at the end handles the delay
        break;

      case 9: // Break Grass/Flowers
        console.log(' -> Looking for grass/flowers to break...');
        const blockToBreak = bot.findBlock({
          matching: (blk) => ['grass', 'short_grass', 'poppy', 'dandelion', 'dead_bush'].includes(blk.name),
          maxDistance: 6,
        });
        if (blockToBreak) {
          console.log(` -> Found and breaking ${blockToBreak.name}`);
          bot.lookAt(blockToBreak.position.offset(0.5, 0.5, 0.5), false, () => { 
            bot.dig(blockToBreak); // Automatically swings arm
          });
        } else { console.log(' -> No grass/flowers nearby.'); }
        break;

      case 10: // Toss Random Item
        console.log(' -> Tossing a random inventory item...');
        // Filter for main inventory (slots 9-35) to avoid tossing armor/hotbar
        const mainInventoryItems = bot.inventory.items().filter(item => item.slot >= 9 && item.slot <= 35);
        if (mainInventoryItems.length > 0) {
          const itemToToss = mainInventoryItems[randomInt(0, mainInventoryItems.length - 1)];
          console.log(` -> Tossing 1x ${itemToToss.name}`);
          bot.toss(itemToToss.type, null, 1); // Toss one of that item
        } else { console.log(' -> No items in main inventory to toss.'); }
        break;
    }

    // Schedule the next random action after a random delay
    const nextActionDelay = randomInt(2000, 7000); // 2-7 second delay
    console.log(`[Info] Next action in ${nextActionDelay}ms...\n`);
    setTimeout(performRandomAction, nextActionDelay);
  }


  // --- Event Listeners ---
  // These are the "ears" of the bot, reacting to server events.

  /**
   * Called once the bot successfully spawns in the world.
   * This is the entry point for all "in-game" logic.
   */
  bot.on('spawn', () => {
    hasSuccessfullySpawned = true; // Mark as successfully connected
    console.log(`✅ ${config.botUsername} has spawned!`);
    
    // Configure pathfinder with default movements for this world
    const defaultMove = new Movements(bot);
    bot.pathfinder.setMovements(defaultMove);
    
    // Start the "human-like" action loop after a short delay
    setTimeout(() => {
      console.log("Starting random action cycle...");
      performRandomAction(); 
    }, 3000);

    // Start the connection watchdog
    console.log('[System] Watchdog started.');
    resetWatchdog();

    // Proactive 3-Hour Reconnect (Human-like behavior)
    console.log(`[System] Session timer started. Bot will proactively reconnect in ${SESSION_DURATION / 1000 / 60 / 60} hours.`);
    setTimeout(() => {
      console.log('[System] Proactive 3-hour session timer elapsed. Triggering a reconnect...');
      bot.end('proactive_session_reconnect'); // 'end' event will call handleDisconnect
    }, SESSION_DURATION);
  });

  /**
   * (Watchdog) "Pets" the watchdog on every server physics tick to keep it from firing.
   */
  bot.on('physicTick', resetWatchdog);
  
  /**
   * Handles incoming chat messages for social interaction.
   */
  bot.on('chat', (username, message) => {
    if (username === bot.username) return; // Ignore self

    const messageLower = message.toLowerCase();
    const botNameLower = config.botUsername.toLowerCase();

    // Check if the bot's name was mentioned
    if (messageLower.includes(botNameLower)) {
      console.log(`[Chat] Mentioned by ${username}: ${message}`);
      
      // Cooldown check (30 seconds) to prevent spam
      const now = Date.now();
      if (now - lastChatReply < 30000) {
        console.log('[Chat] Reply cooldown active, ignoring.');
        return;
      }
      lastChatReply = now; // Reset cooldown

      // Select a random "AFK" reply
      const replies = ["Sorry, I'm AFK.", "brb", "zZzZz...", "?"];
      const reply = replies[randomInt(0, replies.length - 1)];

      // Wait a "human" delay (1.5-4.5s) before replying
      const replyDelay = randomInt(1500, 4500);
      setTimeout(() => { bot.chat(reply); }, replyDelay);
    }
  });

  /**
   * Handles connection errors (e.g., server offline, protocol mismatch).
   * Passes the error to the unified disconnect handler.
   */
  bot.on('error', (err) => {
    console.error('⚠️ Error:', err.message); // Log only the message for clarity
    handleDisconnect(err.message);
  });

  /**
   * Handles being kicked from the server.
   * Passes the reason to the unified disconnect handler.
   */
  bot.on('kicked', (reason) => {
    hasSuccessfullySpawned = true; // If kicked, we must have spawned before
    handleDisconnect(`Kicked: ${JSON.stringify(reason)}`);
  });

  /**
   * Handles the end of the connection (any reason).
   * This will fire after 'error' or 'kicked'. The 'isDisconnecting'
   * flag in handleDisconnect() prevents duplicate reconnect logic.
   */
  bot.on('end', (reason) => {
    handleDisconnect(`Connection ended: ${reason}`);
  });
}

// --- 5. INITIAL CALL ---
// Starts the bot for the first time.
createAndRunBot();
