// =====================================================
// RENDER WEB SUNUCUSU - Render'ın kapanmasını önler
// =====================================================
const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot aktif!\n');
});
server.listen(process.env.PORT || 3000, () => {
  console.log('[System] Web sunucusu baslatildi, Render kapanmayacak.');
});

// =====================================================
// IMPORTS
// =====================================================
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { GoalNearXZ } = goals;

// =====================================================
// CONFIG - config.json'dan oku, hata varsa uyar
// =====================================================
let config;
try {
  config = require('./config.json');
  console.log(`[Config] Yuklendi: ${config.serverHost}:${config.serverPort} | Bot: ${config.botUsername}`);
} catch (e) {
  console.error('[Config] HATA: config.json okunamadi!', e.message);
  process.exit(1);
}

// =====================================================
// SABITLER
// =====================================================
const RECONNECT_DELAY      = 8000;   // Oyun içinde düşerse 8 saniye
const RECONNECT_FAIL_DELAY = 15000;  // Sunucu kapalıysa 15 saniyede bir dene
const WATCHDOG_TIMEOUT     = 45000;  // 45sn tick gelmezse yeniden bağlan
const SESSION_DURATION     = 10800000; // 3 saatte bir proaktif reconnect

// =====================================================
// YARDIMCI FONKSİYON
// =====================================================
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// =====================================================
// ANA BOT FONKSİYONU
// =====================================================
function createAndRunBot() {
  console.log(`[System] Baglanti deneniyor => ${config.serverHost}:${config.serverPort}`);

  let hasSpawned      = false;
  let isDisconnecting = false;
  let isSneaking      = false;
  let lastChatReply   = 0;
  let watchdogTimer   = null;
  let sessionTimer    = null;
  let actionTimer     = null;

  // --- Bot oluştur ---
  let bot;
  try {
    bot = mineflayer.createBot({
      host:                 config.serverHost,
      port:                 config.serverPort,
      username:             config.botUsername,
      auth:                 'offline',
      version:              config.serverVersion,
      viewDistance:         config.viewDistance || 'tiny',
      checkTimeoutInterval: WATCHDOG_TIMEOUT,
      hideErrors:           false,
    });
  } catch (e) {
    console.error('[System] Bot olusturulamadi:', e.message);
    setTimeout(createAndRunBot, RECONNECT_FAIL_DELAY);
    return;
  }

  bot.loadPlugin(pathfinder);

  // --- Watchdog ---
  function resetWatchdog() {
    if (watchdogTimer) clearTimeout(watchdogTimer);
    watchdogTimer = setTimeout(() => {
      console.log('[Watchdog] 45sn tick gelmedi, yeniden baglaniliyor...');
      cleanup();
      bot.end('watchdog_timeout');
    }, WATCHDOG_TIMEOUT);
  }

  // --- Temizlik (timer'ları durdur) ---
  function cleanup() {
    if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
    if (sessionTimer)  { clearTimeout(sessionTimer);  sessionTimer  = null; }
    if (actionTimer)   { clearTimeout(actionTimer);   actionTimer   = null; }
  }

  // --- Disconnect yönetimi ---
  function handleDisconnect(reason) {
    if (isDisconnecting) return;
    isDisconnecting = true;
    cleanup();

    console.log(`[System] Baglanti kesildi: ${reason}`);

    if (hasSpawned) {
      console.log(`[System] ${RECONNECT_DELAY / 1000}sn sonra yeniden baglaniliyor...`);
      setTimeout(createAndRunBot, RECONNECT_DELAY);
    } else {
      console.log(`[System] Sunucu kapali olabilir. ${RECONNECT_FAIL_DELAY / 1000}sn sonra tekrar denenecek...`);
      setTimeout(createAndRunBot, RECONNECT_FAIL_DELAY);
    }
  }

  // --- Hareketler ---
  function performRandomAction() {
    if (!bot || !bot.entity || isDisconnecting) return;

    const actionId = randomInt(0, 9);

    // Pathfinder'ı durdur (wander hariç)
    if (actionId !== 5) {
      try { if (bot.pathfinder.isMoving()) bot.pathfinder.stop(); } catch (_) {}
    }

    try {
      switch (actionId) {
        case 0: { // Kısa yürüyüş
          const dirs = ['forward', 'back', 'left', 'right'];
          const dir  = dirs[randomInt(0, 3)];
          const dur  = randomInt(150, 400);
          console.log(`[Hareket] ${dir} yonune ${dur}ms yuru`);
          bot.setControlState(dir, true);
          setTimeout(() => { try { bot.setControlState(dir, false); } catch (_) {} }, dur);
          break;
        }
        case 1: { // Zıpla
          console.log('[Hareket] Zipla');
          bot.setControlState('jump', true);
          setTimeout(() => { try { bot.setControlState('jump', false); } catch (_) {} }, 200);
          break;
        }
        case 2: { // Etrafa bak
          const yaw   = Math.random() * Math.PI * 2 - Math.PI;
          const pitch = (Math.random() * (Math.PI / 2)) - (Math.PI / 4);
          console.log(`[Hareket] Bak (yaw:${(yaw * 180 / Math.PI).toFixed(0)}°)`);
          bot.look(yaw, pitch, false);
          break;
        }
        case 3: { // Sahte kazma
          console.log('[Hareket] Sahte kazma');
          const blk = bot.findBlock({ matching: (b) => b.type !== 0, maxDistance: 3 });
          if (blk) {
            bot.lookAt(blk.position, false, () => {
              try {
                bot.swingArm();
                setTimeout(() => { try { bot.swingArm(); } catch (_) {} }, 300);
              } catch (_) {}
            });
          } else {
            bot.swingArm();
          }
          break;
        }
        case 4: { // Eğil/kalk
          isSneaking = !isSneaking;
          console.log(`[Hareket] Egil: ${isSneaking}`);
          bot.setControlState('sneak', isSneaking);
          break;
        }
        case 5: { // Dolaş
          if (bot.pathfinder.isMoving()) { console.log('[Hareket] Zaten yuruyorum, atla'); break; }
          const pos = bot.entity.position;
          const tx  = pos.x + randomInt(-12, 12);
          const tz  = pos.z + randomInt(-12, 12);
          console.log(`[Hareket] Dolas (${tx.toFixed(0)}, ${tz.toFixed(0)})`);
          bot.pathfinder.setGoal(new GoalNearXZ(tx, tz, 2));
          break;
        }
        case 6: { // Hotbar değiştir
          const slot = randomInt(0, 8);
          console.log(`[Hareket] Hotbar slot ${slot}`);
          bot.setQuickBarSlot(slot);
          break;
        }
        case 7: { // Yakındaki oyuncuya bak
          const player = bot.nearestEntity((e) => e.type === 'player' && e.username !== bot.username);
          if (player) {
            console.log(`[Hareket] Oyuncuya bak: ${player.username}`);
            bot.lookAt(player.position.offset(0, player.height, 0));
          } else {
            console.log('[Hareket] Yakin oyuncu yok, bos bak');
            const yaw = Math.random() * Math.PI * 2 - Math.PI;
            bot.look(yaw, 0, false);
          }
          break;
        }
        case 8: { // Boşta dur
          console.log('[Hareket] Bosta dur');
          break;
        }
        case 9: { // Çimen/çiçek kır
          console.log('[Hareket] Cimen ara');
          const grass = bot.findBlock({
            matching: (b) => ['grass', 'short_grass', 'poppy', 'dandelion', 'dead_bush'].includes(b.name),
            maxDistance: 5,
          });
          if (grass) {
            console.log(`[Hareket] ${grass.name} kir`);
            bot.lookAt(grass.position.offset(0.5, 0.5, 0.5), false, () => {
              try { bot.dig(grass); } catch (_) {}
            });
          } else {
            console.log('[Hareket] Cimen bulunamadi');
          }
          break;
        }
      }
    } catch (e) {
      console.log('[Hareket] Hata (atlandi):', e.message);
    }

    const delay = randomInt(2000, 6000);
    console.log(`[Hareket] Sonraki: ${delay}ms\n`);
    actionTimer = setTimeout(performRandomAction, delay);
  }

  // =====================================================
  // EVENT LISTENERS
  // =====================================================

  bot.on('spawn', () => {
    hasSpawned = true;
    console.log(`✅ ${config.botUsername} sunucuya girdi!`);

    try {
      const defaultMove = new Movements(bot);
      bot.pathfinder.setMovements(defaultMove);
    } catch (e) {
      console.log('[Pathfinder] Uyari:', e.message);
    }

    // Hareketleri başlat
    actionTimer = setTimeout(() => {
      console.log('[System] Hareket dongusu basliyor...');
      performRandomAction();
    }, 3000);

    // Watchdog başlat
    resetWatchdog();

    // 3 saatlik session timer
    sessionTimer = setTimeout(() => {
      console.log('[System] 3 saatlik session tamamlandi, yeniden baglaniliyor...');
      cleanup();
      bot.end('session_end');
    }, SESSION_DURATION);

    console.log(`[System] Session suresi: 3 saat`);
  });

  bot.on('physicTick', resetWatchdog);

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    const lower = message.toLowerCase();
    if (lower.includes(config.botUsername.toLowerCase())) {
      const now = Date.now();
      if (now - lastChatReply < 30000) return;
      lastChatReply = now;
      const replies = ["Sorry, I'm AFK.", "brb", "zZzZz...", "?"];
      const delay   = randomInt(1500, 4500);
      setTimeout(() => { try { bot.chat(replies[randomInt(0, replies.length - 1)]); } catch (_) {} }, delay);
    }
  });

  bot.on('error', (err) => {
    console.error('[Hata]', err.message);
    handleDisconnect(err.message);
  });

  bot.on('kicked', (reason) => {
    hasSpawned = true;
    handleDisconnect(`Atildi: ${JSON.stringify(reason)}`);
  });

  bot.on('end', (reason) => {
    handleDisconnect(`Baglanti bitti: ${reason}`);
  });
}

// =====================================================
// BASLAT
// =====================================================
createAndRunBot();

process.on('SIGINT',  () => { console.log('Durduruluyor...'); process.exit(0); });
process.on('SIGTERM', () => { console.log('Durduruluyor...'); process.exit(0); });
process.on('uncaughtException', (err) => {
  console.error('[Kritik Hata]', err.message);
  setTimeout(createAndRunBot, 10000);
});
