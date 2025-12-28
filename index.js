require('dotenv').config();
const { RestClientV5 } = require('bybit-api');
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token, { polling: true });
const client = new RestClientV5({ testnet: false });
let alerts = {};
let userStates = {};

// 🆕 INLINE КНОПКИ (как на скрине)
const mainKeyboard = {
  reply_markup: {
    keyboard: [
      ['🔔 Добавить', '🗑️ Удалить'],
      ['📋 Мои оповещения', '🔄 Обновить']
    ],
    resize_keyboard: true
  }
};

// /start
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, '🚀 Bybit Price Alerts готов!\nВыбери действие:', mainKeyboard);
  console.log('✅ /start:', msg.chat.id);
});

// 🆕 ОБРАБОТКА КНОПОК (reply_keyboard)
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  
  console.log(`DEBUG: "${text}"`);  ← ВОТ ЗДЕСЬ! (НОВАЯ СТРОКА)

  if (!text) return; // Игнор медиа

  // КНОПКИ
  if (text === '🔔 Добавить') {
    userStates[chatId] = { waitingFor: 'add' };
    bot.sendMessage(chatId, '📝 Введите токен и цену:\nПример: BTC 100000 >', mainKeyboard);
    console.log('🔔 Добавить:', chatId);
  }
  else if (text === '🗑️ Удалить') {
    userStates[chatId] = { waitingFor: 'remove' };
    bot.sendMessage(chatId, '🗑️ Введите токен и цену для удаления:\nПример: BTC 100000', mainKeyboard);
    console.log('🗑️ Удалить:', chatId);
  }
  else if (text === '📋 Мои оповещения') {
    if (!alerts[chatId]?.length) {
      bot.sendMessage(chatId, '📭 Нет оповещения.', mainKeyboard);
    } else {
      const list = alerts[chatId].map(a => `${a.symbol} ${a.op} ${a.price}`).join('\n');
      bot.sendMessage(chatId, `📋 Алертс (${alerts[chatId].length}):\n${list}`, mainKeyboard);
    }
    console.log('📋 Мои оповещения:', chatId);
  }
  else if (text === '🔄 Обновить') {
    bot.sendMessage(chatId, '✅ Готово к приёму оповещения!', mainKeyboard);
    console.log('🔄 Обновить:', chatId);
  }
  // ВВОД оповещения
  else if (userStates[chatId]?.waitingFor === 'add') {
    const match = text.match(/([A-Z]{3,})(?:\s+USDT)?\s+(\d+(?:\.\d+)?)\s*([><=])?/i);
    if (match) {
      const symbol = match[1].toUpperCase() + 'USDT';
      const price = parseFloat(match[2]);
      const op = match[3] || '>';

      if (!alerts[chatId]) alerts[chatId] = [];
      alerts[chatId].push({ symbol, price, op });

      bot.sendMessage(chatId, `✅ Добавлен: ${symbol} ${op} ${price}`, mainKeyboard);
      console.log(`✅ Оповещение добавлен: ${symbol} ${op} ${price}`);
      saveAlerts();
      delete userStates[chatId];
    } else {
      bot.sendMessage(chatId, '❌ Формат: BTC 100000 > (или < или =)', mainKeyboard);
    }
  }
  else if (userStates[chatId]?.waitingFor === 'remove') {
    const match = text.match(/([A-Z]{3,})(?:\s+USDT)?\s+(\d+(?:\.\d+)?)/i);
    if (match) {
      const symbol = match[1].toUpperCase() + 'USDT';
      const price = parseFloat(match[2]);

      if (alerts[chatId]) {
        const index = alerts[chatId].findIndex(a => 
          a.symbol === symbol && Math.abs(a.price - price) < 0.01
        );
        if (index > -1) {
          alerts[chatId].splice(index, 1);
          bot.sendMessage(chatId, `🗑️ Удалён: ${symbol} ${price}`, mainKeyboard);
          console.log(`🗑️ Оповещение удалён: ${symbol} ${price}`);
          saveAlerts();
        } else {
          bot.sendMessage(chatId, '❌ Оповещение не найден.', mainKeyboard);
        }
      }
      delete userStates[chatId];
    } else {
      bot.sendMessage(chatId, '❌ Формат: BTC 100000', mainKeyboard);
    }
  }
});

// ⚡ ЧЕКЕР КАЖДЫЕ 30 СЕКУНД
setInterval(async () => {
  for (const chatId in alerts) {
    for (let i = 0; i < alerts[chatId].length; i++) {
      const alert = alerts[chatId][i];
      const cleanSymbol = alert.symbol.replace(/USDTUSDT/gi, 'USDT');

      try {
        const tickerResp = await client.getTickers({ 
          category: 'linear', 
          symbol: cleanSymbol 
        });

        if (tickerResp.result?.list?.[0]?.lastPrice) {
          const price = parseFloat(tickerResp.result.list[0].lastPrice);
          let triggered = false;

          if (alert.op === '>') triggered = price > alert.price;
          else if (alert.op === '<') triggered = price < alert.price;
          else if (alert.op === '=') triggered = Math.abs(price - alert.price) < price * 0.001;

          if (triggered) {
            bot.sendMessage(chatId, `🔔 *${cleanSymbol} достиг цены ${alert.price}!*\n💰 Текущая: $${price.toFixed(4)}`, {
              parse_mode: 'Markdown',
              reply_markup: mainKeyboard
            });
            console.log(`🚨 СРАБОТАЛ: ${cleanSymbol} ${price.toFixed(4)} ${alert.op} ${alert.price}`);
            alerts[chatId].splice(i--, 1);
            saveAlerts();
          }
        }
      } catch (e) {
        // Тихо игнорим API ошибки
      }
    }
  }
}, 30000);

function saveAlerts() {
  require('fs').writeFileSync('alerts.json', JSON.stringify(alerts, null, 2));
}

function loadAlerts() {
  try {
    alerts = require('./alerts.json');
  } catch (e) {}
}
loadAlerts();

console.log('🚀 Бот ГОТОВ 24/7!');
