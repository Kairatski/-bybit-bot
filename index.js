require('dotenv').config();
const { RestClientV5 } = require('bybit-api');
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token, { polling: true });
const client = new RestClientV5({ testnet: false });
let alerts = {};
let userStates = {};

const actionKeyboard = {
  reply_markup: {
    keyboard: [
      ['🔔 Добавить', '🗑️ Удалить'],
      ['📋 Мои оповещения', '🔄 Обновить']
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  }
};

// /start
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, '🚀 Bybit Price Alerts готов!\nВыбери действие:', actionKeyboard);
  console.log('✅ /start:', msg.chat.id);
});

// Обработка кнопок и алертов
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  
  if (text === '➕ Добавить алерт') {
    userStates[chatId] = { waitingFor: 'add' };
    bot.sendMessage(chatId, '📝 Введите токен и цену:\nПример: BTC 100000 > или BTCUSDT 100000 <', actionKeyboard);
  }
  else if (text === '🗑️ Удалить алерт') {
    userStates[chatId] = { waitingFor: 'remove' };
    bot.sendMessage(chatId, '🗑️ Введите токен и цену для удаления:\nПример: BTC 100000', actionKeyboard);
  }
  else if (text === '📋 Мои алерты') {
    if (!alerts[chatId]?.length) {
      bot.sendMessage(chatId, '📭 Нет алертов.', actionKeyboard);
    } else {
      const list = alerts[chatId].map(a => `${a.symbol} ${a.op || ''} ${a.price}`).join('\n');
      bot.sendMessage(chatId, `📋 Алертс (${alerts[chatId].length}):\n${list}`, actionKeyboard);
    }
  }
  else if (text === '🔄 Обновить') {
    bot.sendMessage(chatId, '🔄 Проверяю цены прямо сейчас...', actionKeyboard);
  }
  
  // ЛОГИКА АЛЕРТОВ
  else if (userStates[chatId]) {
    const state = userStates[chatId];
    
    if (state.waitingFor === 'add') {
      const match = text.match(/([A-Z]{3,})(?:\s+USDT)?\s+(\d+(?:\.\d+)?)\s*([><=])?/i);
      if (match) {
        const symbol = match[1].toUpperCase() + 'USDT';
        const price = parseFloat(match[2]);
        const op = match[3] || '>';
        
        if (!alerts[chatId]) alerts[chatId] = [];
        alerts[chatId].push({ symbol, price, op });
        
        bot.sendMessage(chatId, `✅ Добавлен: ${symbol} ${op} ${price}`, actionKeyboard);
        saveAlerts();
        delete userStates[chatId];
        console.log(`✅ Новый алерт: ${symbol} ${op} ${price}`);
      } else {
        bot.sendMessage(chatId, '❌ Формат: BTC 100000 >', actionKeyboard);
      }
    }
    
    else if (state.waitingFor === 'remove') {
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
            bot.sendMessage(chatId, `🗑️ Удалён: ${symbol} ${price}`, actionKeyboard);
            saveAlerts();
            console.log(`🗑️ Удалён алерт: ${symbol} ${price}`);
          } else {
            bot.sendMessage(chatId, '❌ Алерт не найден.', actionKeyboard);
          }
        }
        delete userStates[chatId];
      } else {
        bot.sendMessage(chatId, '❌ Формат: BTC 100000', actionKeyboard);
      }
    }
  }
});

// 🔄 ЧИСТЫЙ ЧЕКЕР 30 СЕКУНД (БЕЗ СПАМА)
setInterval(async () => {
  console.log('🔄 Чек цен (30 сек)...');
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
          
          // ✅ УБРАЛИ СПАМ! Только срабатывания
          if (triggered) {
            const alertText = `${cleanSymbol} достиг цены ${alert.price}!`;
            bot.sendMessage(chatId, `🔔 *${alertText}*\n💰 Текущая: $${price.toFixed(4)}`, {
              parse_mode: 'Markdown',
              reply_markup: actionKeyboard
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

console.log('🚀 Бот ЧИСТЫЙ запущен!');
