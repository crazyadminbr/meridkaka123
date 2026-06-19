require('dotenv').config();
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const {
  initDB, upsertUser, getUser,
  createResume, hasPendingResume, getPendingResumes, updateResumeStatus, getResumeById,
  createTicket, hasActiveTicket, getOpenTickets, getTicketById, takeTicket, closeTicket
} = require('./database');
const {
  mainMenu, profileMenu, faqMenu, faqPage2Menu,
  cancelResume, cancelSupport, sharePhoneKeyboard,
  adminResumeMenu, adminResumeActionMenu,
  adminTicketMenu, adminTicketActionMenu,
  activeTicketMenu, adminPanelMenu
} = require('./keyboards');
const { START_TEXT, FAQ_PAGE_1, FAQ_PAGE_2, formatProfile, POSITIONS } = require('./constants');

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) { console.error('❌ BOT_TOKEN не задан в .env!'); process.exit(1); }

const ADMIN_IDS = (process.env.ADMIN_IDS || '')
  .split(',').map(id => parseInt(id.trim())).filter(n => !isNaN(n));

console.log('ADMIN_IDS loaded:', ADMIN_IDS);

// ── Обязательная подписка на канал ────────────────────────────
const CHANNEL_USERNAME = 'KM_gameRU';          // без @
const CHANNEL_LINK      = `https://t.me/${CHANNEL_USERNAME}`;

const bot = new TelegramBot(TOKEN, {
  polling: {
    interval: 300,
    autoStart: true,
    params: {
      timeout: 10
    }
  }
});

// Защита от повторной обработки одного и того же апдейта
// (на случай дублирования long-polling сессий Telegram)
const processedUpdates = new Set();
const MAX_PROCESSED_CACHE = 500;

function isDuplicateUpdate(key) {
  if (key == null) return false;
  if (processedUpdates.has(key)) return true;
  processedUpdates.add(key);
  if (processedUpdates.size > MAX_PROCESSED_CACHE) {
    const first = processedUpdates.values().next().value;
    processedUpdates.delete(first);
  }
  return false;
}

const userStates  = {};
const adminToUser = {}; // adminId  -> { ticketId, userChatId }
const userToAdmin = {}; // userId   -> adminId

function isAdmin(id) {
  const numId = Number(id);
  const result = ADMIN_IDS.includes(numId);
  return result;
}
function setState(id, s) { userStates[Number(id)] = s; }
function getState(id)    { return userStates[Number(id)] || {}; }
function clearState(id)  { delete userStates[Number(id)]; }

// Проверка подписки пользователя на канал
async function isSubscribed(userId) {
  if (isAdmin(userId)) return true; // админам подписка не нужна
  try {
    const member = await bot.getChatMember(`@${CHANNEL_USERNAME}`, userId);
    return ['creator', 'administrator', 'member'].includes(member.status);
  } catch (e) {
    console.error('Subscription check error:', e.message);
    // Если бот не может проверить (не админ канала, неверный username и т.п.)
    // лучше пропустить пользователя, чем заблокировать всех из-за ошибки конфигурации
    return true;
  }
}

const subscribeKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '📢 Подписаться на канал', url: CHANNEL_LINK }],
      [{ text: '✅ Я подписался', callback_data: 'check_subscription' }]
    ]
  }
};

async function sendSubscribeRequest(chatId) {
  await bot.sendMessage(chatId,
    `🔒 <b>Доступ ограничен</b>\n\n` +
    `Для использования бота нужно подписаться на наш официальный канал:\n` +
    `👉 <b>@${CHANNEL_USERNAME}</b>\n\n` +
    `После подписки нажмите кнопку «✅ Я подписался» ниже.`,
    { parse_mode: 'HTML', ...subscribeKeyboard }
  );
}

async function sendMain(chatId) {
  const photoPath = path.join(__dirname, 'image.png');
  const exists = fs.existsSync(photoPath);
  console.log(`[sendMain] __dirname=${__dirname} photoPath=${photoPath} exists=${exists}`);

  if (exists) {
    try {
      return await bot.sendPhoto(chatId, photoPath, {
        caption: START_TEXT,
        parse_mode: 'HTML',
        ...mainMenu
      });
    } catch (e) {
      console.error('[sendMain] sendPhoto failed:', e.message);
      // если отправка фото не удалась — fallback на текст, чтобы юзер не остался без ответа
    }
  }
  return bot.sendMessage(chatId, START_TEXT, { parse_mode: 'HTML', ...mainMenu });
}

async function forwardMedia(msg, targetChatId, caption) {
  const opts = caption ? { caption, parse_mode: 'HTML' } : {};
  try {
    if (msg.photo)    return await bot.sendPhoto(targetChatId,    msg.photo[msg.photo.length-1].file_id, opts);
    if (msg.document) return await bot.sendDocument(targetChatId, msg.document.file_id, opts);
    if (msg.video)    return await bot.sendVideo(targetChatId,    msg.video.file_id, opts);
    if (msg.audio)    return await bot.sendAudio(targetChatId,    msg.audio.file_id, opts);
    if (msg.voice)    return await bot.sendVoice(targetChatId,    msg.voice.file_id, opts);
    if (msg.sticker)  return await bot.sendSticker(targetChatId,  msg.sticker.file_id);
  } catch(e) { console.error('forwardMedia error:', e.message); }
}

// ═══════════════════════════════════════════════════════════
//  /start
// ═══════════════════════════════════════════════════════════
bot.onText(/\/start/, async (msg) => {
  if (isDuplicateUpdate(`msg_${msg.chat.id}_${msg.message_id}`)) return;

  upsertUser(msg.from);
  clearState(msg.from.id);

  if (!(await isSubscribed(msg.from.id))) {
    await sendSubscribeRequest(msg.chat.id);
    return;
  }

  await sendMain(msg.chat.id);
});

// ═══════════════════════════════════════════════════════════
//  /admin
// ═══════════════════════════════════════════════════════════
bot.onText(/\/admin/, async (msg) => {
  if (isDuplicateUpdate(`msg_${msg.chat.id}_${msg.message_id}`)) return;
  if (!isAdmin(msg.from.id)) return;
  await bot.sendMessage(msg.chat.id, '🛡️ <b>Панель администратора</b>', {
    parse_mode: 'HTML', ...adminPanelMenu()
  });
});

// ═══════════════════════════════════════════════════════════
//  Входящие сообщения
// ═══════════════════════════════════════════════════════════
bot.on('message', async (msg) => {
  if (msg.via_bot) return;
  if (isDuplicateUpdate(`msg_${msg.chat.id}_${msg.message_id}`)) return;

  const chatId   = msg.chat.id;
  const userId   = Number(msg.from.id);
  const text     = msg.text || '';
  const hasMedia = !!(msg.photo||msg.document||msg.video||msg.audio||msg.voice||msg.sticker);

  // Команды обрабатываются отдельными bot.onText — не дублируем их здесь
  if (text.startsWith('/start') || text.startsWith('/admin')) return;

  upsertUser(msg.from);

  // ─── 0. Проверка подписки на канал ──────────────────────────
  if (!(await isSubscribed(userId))) {
    await sendSubscribeRequest(chatId);
    return;
  }

  // ─── 1. Контакт (телефон в резюме) ─────────────────────────
  if (msg.contact) {
    const state = getState(userId);
    if (state.step === 'resume_phone') {
      state.data.phone = msg.contact.phone_number;
      setState(userId, { ...state, step: 'resume_timezone' });
      await bot.sendMessage(chatId,
        `✅ Номер <code>${state.data.phone}</code> получен!\n\n` +
        `📝 Шаг 4/6 — Введите ваш часовой пояс (например: UTC+3, МСК, GMT+5):`,
        { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } }
      );
    }
    return;
  }

  // ─── 2. Шаги форм (приоритет перед чатом тикетов) ──────────
  const state = getState(userId);
  if (state.step) {
    await handleStep(msg, state, chatId, userId, text);
    return;
  }

  // ─── 3. Админ с активным тикетом → пересылаем юзеру ────────
  if (isAdmin(userId)) {
    const session = adminToUser[userId];
    if (session && text && !text.startsWith('/')) {
      try {
        if (hasMedia) await forwardMedia(msg, session.userChatId, null);
        else await bot.sendMessage(session.userChatId,
          `📨 <b>Сообщение от оператора:</b>\n\n${text}`,
          { parse_mode: 'HTML' }
        );
      } catch(e) {
        await bot.sendMessage(chatId, '❌ Не удалось отправить пользователю.');
      }
      return;
    }
  }

  // ─── 4. Юзер с активным тикетом → пересылаем админу ────────
  if (!isAdmin(userId)) {
    const targetAdmin = userToAdmin[userId];
    if (targetAdmin) {
      const user = getUser(userId);
      const label = `💬 <b>${user?.full_name||userId}</b> (@${user?.username||'нет'}):`;
      if (hasMedia) await forwardMedia(msg, targetAdmin, label);
      else if (text) await bot.sendMessage(targetAdmin, `${label}\n${text}`, { parse_mode: 'HTML' }).catch(()=>{});
      return;
    }
  }

  // ─── 5. Главные кнопки ──────────────────────────────────────
  switch (text) {
    case '👤 Профиль': {
      const user = getUser(userId);
      await bot.sendMessage(chatId, formatProfile(user), { parse_mode: 'HTML', ...profileMenu });
      return;
    }
    case '❓ FAQ':
      await bot.sendMessage(chatId, FAQ_PAGE_1, { parse_mode: 'HTML', ...faqMenu });
      return;

    case '📝 Подача резюме': {
      if (hasPendingResume(userId)) {
        await bot.sendMessage(chatId,
          '⚠️ У вас уже есть резюме <b>на рассмотрении</b>.\n\nПодождите решения администратора.',
          { parse_mode: 'HTML' }
        );
        return;
      }
      setState(userId, { step: 'resume_name', data: {} });
      await bot.sendMessage(chatId,
        '📝 <b>ПОДАЧА РЕЗЮМЕ</b>\n\nШаг 1/6 — Введите ваше имя:',
        { parse_mode: 'HTML', ...cancelResume }
      );
      return;
    }

    case '🆘 Поддержка': {
      const active = hasActiveTicket(userId);
      if (active) {
        await bot.sendMessage(chatId,
          `⚠️ У вас уже есть открытое обращение <b>#${active.id}</b>.\n\nДождитесь его закрытия.`,
          { parse_mode: 'HTML' }
        );
        return;
      }
      setState(userId, { step: 'support_msg' });
      await bot.sendMessage(chatId,
        '🆘 <b>ПОДДЕРЖКА</b>\n\nОпишите проблему. Можно прикрепить фото — оператор получит его:',
        { parse_mode: 'HTML', ...cancelSupport }
      );
      return;
    }
  }
});

// ═══════════════════════════════════════════════════════════
//  Шаги форм
// ═══════════════════════════════════════════════════════════
async function handleStep(msg, state, chatId, userId, text) {
  if (text === '/start') { clearState(userId); await sendMain(chatId); return; }

  const hasMedia = !!(msg.photo||msg.document||msg.video||msg.audio||msg.voice);

  // РЕЗЮМЕ ────────────────────────────────────────────────────
  if (state.step === 'resume_name') {
    if (!text || text.length < 2)
      return bot.sendMessage(chatId, '⚠️ Введите имя (минимум 2 символа):', cancelResume);
    state.data.name = text;
    setState(userId, { ...state, step: 'resume_age' });
    return bot.sendMessage(chatId, '📝 Шаг 2/6 — Введите ваш возраст:', cancelResume);
  }

  if (state.step === 'resume_age') {
    const age = parseInt(text);
    if (isNaN(age) || age < 16 || age > 80)
      return bot.sendMessage(chatId, '⚠️ Возраст от 16 до 80:', cancelResume);
    state.data.age = age;
    setState(userId, { ...state, step: 'resume_phone' });
    await bot.sendMessage(chatId, '📝 Шаг 3/6 — Поделитесь номером телефона:', cancelResume);
    await bot.sendMessage(chatId, '👇 Нажмите кнопку:', sharePhoneKeyboard);
    return;
  }

  if (state.step === 'resume_timezone') {
    if (!text) return bot.sendMessage(chatId, '⚠️ Введите часовой пояс:', cancelResume);
    state.data.timezone = text;
    setState(userId, { ...state, step: 'resume_position' });
    const btns = POSITIONS.map(p => [{ text: p, callback_data: `pos_${p}` }]);
    btns.push([{ text: '❌ Отмена', callback_data: 'cancel_resume' }]);
    return bot.sendMessage(chatId, '📝 Шаг 5/6 — Выберите должность:', {
      reply_markup: { inline_keyboard: btns }
    });
  }

  if (state.step === 'resume_motivation') {
    if (!text || text.length < 10)
      return bot.sendMessage(chatId, '⚠️ Напишите подробнее (мин. 10 символов):', cancelResume);
    state.data.motivation = text;
    setState(userId, { ...state, step: 'resume_confirm' });
    return bot.sendMessage(chatId,
      `📋 <b>ПРОВЕРЬТЕ РЕЗЮМЕ</b>\n\n` +
      `• Имя: <b>${state.data.name}</b>\n` +
      `• Возраст: <b>${state.data.age}</b>\n` +
      `• Телефон: <b>${state.data.phone||'не указан'}</b>\n` +
      `• Часовой пояс: <b>${state.data.timezone}</b>\n` +
      `• Должность: <b>${state.data.desired_position}</b>\n` +
      `• Мотивация: ${state.data.motivation}\n\nОтправить?`,
      {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[
          { text: '✅ Отправить', callback_data: 'resume_submit' },
          { text: '❌ Отмена',   callback_data: 'cancel_resume'  }
        ]]}
      }
    );
  }

  // ПОДДЕРЖКА ─────────────────────────────────────────────────
  if (state.step === 'support_msg') {
    if (!text && !hasMedia)
      return bot.sendMessage(chatId, '⚠️ Отправьте текст или медиафайл:', cancelSupport);
    if (text && text.length < 5)
      return bot.sendMessage(chatId, '⚠️ Сообщение слишком короткое:', cancelSupport);

    const ticketId = createTicket(userId, text || '[медиафайл]');
    clearState(userId);

    await bot.sendMessage(chatId,
      `✅ <b>Обращение #${ticketId} принято!</b>\n\nОператор свяжется с вами в ближайшее время.`,
      { parse_mode: 'HTML', ...mainMenu }
    );

    const user = getUser(userId);
    const notif =
      `🆘 <b>Новый тикет #${ticketId}</b>\n\n` +
      `👤 ${user.full_name} (@${user.username||'нет'})\n` +
      `🆔 ID: <code>${userId}</code>\n` +
      `📝 ${text||'[медиафайл]'}`;

    for (const adminId of ADMIN_IDS) {
      try {
        await bot.sendMessage(adminId, notif, {
          parse_mode: 'HTML',
          ...adminTicketMenu(ticketId, userId)
        });
        if (hasMedia) await forwardMedia(msg, adminId, `📎 от ${user.full_name}`);
      } catch(_) {}
    }
    return;
  }
}

// ═══════════════════════════════════════════════════════════
//  Callback Query
// ═══════════════════════════════════════════════════════════
bot.on('callback_query', async (query) => {
  if (isDuplicateUpdate(`cb_${query.id}`)) return;

  const chatId = query.message.chat.id;
  const userId = Number(query.from.id);
  const data   = query.data;
  const msgId  = query.message.message_id;

  console.log(`[CB] userId=${userId} isAdmin=${isAdmin(userId)} data=${data}`);

  // Отвечаем сразу чтобы убрать "часики"
  await bot.answerCallbackQuery(query.id).catch(() => {});

  // ── Проверка подписки по кнопке "Я подписался" ─────────────
  if (data === 'check_subscription') {
    const subscribed = await isSubscribed(userId);
    if (subscribed) {
      try { await bot.deleteMessage(chatId, msgId); } catch (_) {}
      await sendMain(chatId);
    } else {
      await bot.answerCallbackQuery(query.id, {
        text: '❌ Вы ещё не подписались на канал',
        show_alert: true
      });
    }
    return;
  }

  // ── Общий гейт — без подписки дальше не пускаем ─────────────
  if (!(await isSubscribed(userId))) {
    await sendSubscribeRequest(chatId);
    return;
  }

  // ── Выбор должности ───────────────────────────────────────
  if (data.startsWith('pos_')) {
    const state = getState(userId);
    if (state.step !== 'resume_position') return;
    state.data.desired_position = data.slice(4);
    setState(userId, { ...state, step: 'resume_motivation' });
    await bot.editMessageText(
      '📝 Шаг 6/6 — Почему мы должны взять именно вас?\n\n<i>Расскажите о навыках и опыте:</i>',
      { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', ...cancelResume }
    );
    return;
  }

  // ── Отправить резюме ──────────────────────────────────────
  if (data === 'resume_submit') {
    const state = getState(userId);
    if (state.step !== 'resume_confirm') return;
    const user     = getUser(userId);
    const resumeId = createResume({
      telegram_id: userId, username: user.username, full_name: user.full_name,
      ...state.data
    });
    clearState(userId);

    await bot.editMessageText(
      `✅ <b>Резюме #${resumeId} подано!</b>\n\nАдминистратор рассмотрит его и свяжется с вами.`,
      { chat_id: chatId, message_id: msgId, parse_mode: 'HTML' }
    );
    await sendMain(chatId);

    const notif =
      `📋 <b>Новое резюме #${resumeId}</b>\n\n` +
      `👤 ${state.data.name}, ${state.data.age} лет\n` +
      `📞 Телефон: ${state.data.phone||'не указан'}\n` +
      `📍 Часовой пояс: ${state.data.timezone}\n` +
      `💼 Должность: ${state.data.desired_position}\n` +
      `✍️ Мотивация: ${state.data.motivation}\n\n` +
      `Telegram: @${user.username||'нет'} | ID: <code>${userId}</code>`;

    for (const adminId of ADMIN_IDS) {
      try {
        await bot.sendMessage(adminId, notif, {
          parse_mode: 'HTML',
          ...adminResumeMenu(resumeId, userId, user.username)
        });
      } catch(_) {}
    }
    return;
  }

  // ── Принять / Отклонить резюме ────────────────────────────
  if (data.startsWith('resume_accept_') || data.startsWith('resume_reject_')) {
    console.log(`[RESUME] userId=${userId} isAdmin=${isAdmin(userId)} data=${data}`);

    if (!isAdmin(userId)) {
      await bot.sendMessage(chatId, '❌ У вас нет прав администратора.');
      return;
    }

    const isAccept = data.startsWith('resume_accept_');
    const prefix   = isAccept ? 'resume_accept_' : 'resume_reject_';
    const resumeId = parseInt(data.slice(prefix.length));

    console.log(`[RESUME] resumeId=${resumeId}`);

    if (isNaN(resumeId)) {
      await bot.sendMessage(chatId, '❌ Ошибка: неверный ID резюме.');
      return;
    }

    const resume = getResumeById(resumeId);
    if (!resume) {
      await bot.sendMessage(chatId, `❌ Резюме #${resumeId} не найдено в БД.`);
      return;
    }

    if (resume.status !== 'pending') {
      await bot.sendMessage(chatId,
        resume.status === 'accepted' ? '✅ Резюме уже принято.' : '❌ Резюме уже отклонено.'
      );
      return;
    }

    updateResumeStatus(resumeId, isAccept ? 'accepted' : 'rejected', userId);

    // Пробуем editMessageText, если не получается — просто шлём новое сообщение
    try {
      await bot.editMessageText(
        isAccept
          ? `✅ <b>Резюме #${resumeId} принято</b>\n👤 ${resume.name}`
          : `❌ <b>Резюме #${resumeId} отклонено</b>\n👤 ${resume.name}`,
        {
          chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[
            { text: '💬 Написать соискателю', url: `tg://user?id=${resume.telegram_id}` }
          ]]}
        }
      );
    } catch(e) {
      console.error('[RESUME] editMessageText error:', e.message);
      await bot.sendMessage(chatId,
        isAccept
          ? `✅ <b>Резюме #${resumeId} принято</b> — ${resume.name}`
          : `❌ <b>Резюме #${resumeId} отклонено</b> — ${resume.name}`,
        { parse_mode: 'HTML' }
      );
    }

    try {
      await bot.sendMessage(resume.telegram_id,
        isAccept
          ? `🎉 <b>Поздравляем!</b>\n\nВаше резюме на должность <b>${resume.desired_position}</b> <b>принято</b>!\n\nС вами свяжется администратор.`
          : `😔 Ваше резюме на должность <b>${resume.desired_position}</b> <b>отклонено</b>.\n\nМожете подать повторно.`,
        { parse_mode: 'HTML' }
      );
    } catch(_) {}
    return;
  }

  // ── Принять тикет ─────────────────────────────────────────
  if (data.startsWith('ticket_take_')) {
    console.log(`[TICKET_TAKE] userId=${userId} isAdmin=${isAdmin(userId)}`);

    if (!isAdmin(userId)) {
      await bot.sendMessage(chatId, '❌ У вас нет прав администратора.');
      return;
    }

    const ticketId = parseInt(data.slice('ticket_take_'.length));
    const ticket   = getTicketById(ticketId);

    if (!ticket) { await bot.sendMessage(chatId, '❌ Тикет не найден.'); return; }
    if (ticket.status !== 'open') {
      await bot.sendMessage(chatId, '⚠️ Тикет уже занят или закрыт.');
      return;
    }

    takeTicket(ticketId, userId);
    adminToUser[userId]             = { ticketId, userChatId: ticket.telegram_id };
    userToAdmin[ticket.telegram_id] = userId;

    try {
      await bot.editMessageText(
        `🙋 <b>Тикет #${ticketId} принят</b>\n\n` +
        `Все сообщения пользователя приходят сюда.\n` +
        `<i>Просто пишите в этот чат — ответы уйдут пользователю.</i>`,
        { chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
          ...activeTicketMenu(ticketId, ticket.telegram_id) }
      );
    } catch(e) {
      await bot.sendMessage(chatId,
        `🙋 <b>Тикет #${ticketId} принят.</b>\n\nПишите сюда — ответы уйдут пользователю.`,
        { parse_mode: 'HTML', ...activeTicketMenu(ticketId, ticket.telegram_id) }
      );
    }

    for (const adminId of ADMIN_IDS) {
      if (adminId === userId) continue;
      try {
        await bot.sendMessage(adminId,
          `ℹ️ Тикет #${ticketId} принят оператором <code>${userId}</code>`,
          { parse_mode: 'HTML' }
        );
      } catch(_) {}
    }

    try {
      await bot.sendMessage(ticket.telegram_id,
        `🙋 <b>Оператор подключился!</b>\n\nОбращение #${ticketId} принято в работу.\nПросто пишите сюда — оператор получит ваше сообщение.`,
        { parse_mode: 'HTML' }
      );
    } catch(_) {}
    return;
  }

  // ── Закрыть тикет ─────────────────────────────────────────
  if (data.startsWith('ticket_close_')) {
    if (!isAdmin(userId)) return;
    const ticketId   = parseInt(data.slice('ticket_close_'.length));
    const ticket     = getTicketById(ticketId);
    if (!ticket) return;

    closeTicket(ticketId);
    const userChatId = adminToUser[userId]?.userChatId;
    delete adminToUser[userId];
    if (userChatId) delete userToAdmin[userChatId];

    try {
      await bot.editMessageText(`✅ <b>Тикет #${ticketId} закрыт</b>`,
        { chat_id: chatId, message_id: msgId, parse_mode: 'HTML' }
      );
    } catch(e) {
      await bot.sendMessage(chatId, `✅ Тикет #${ticketId} закрыт.`);
    }

    if (userChatId) {
      try {
        await bot.sendMessage(userChatId,
          `✅ <b>Ваше обращение #${ticketId} закрыто.</b>\n\nЕсли возникнут вопросы — обращайтесь снова!`,
          { parse_mode: 'HTML', ...mainMenu }
        );
      } catch(_) {}
    }
    return;
  }

  // ── Список резюме (панель) ────────────────────────────────
  if (data === 'admin_resumes') {
    if (!isAdmin(userId)) return;
    const resumes = getPendingResumes();
    if (resumes.length === 0) {
      await bot.editMessageText('📋 <b>Нет новых резюме</b>',
        { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', ...adminPanelMenu() }
      );
      return;
    }
    await bot.editMessageText(`📋 <b>Новых резюме: ${resumes.length}</b>`,
      { chat_id: chatId, message_id: msgId, parse_mode: 'HTML' }
    );
    for (const r of resumes.slice(0, 10)) {
      await bot.sendMessage(chatId,
        `📋 <b>Резюме #${r.id}</b>\n\n` +
        `👤 ${r.name}, ${r.age} лет\n📞 ${r.phone||'не указан'}\n` +
        `📍 ${r.timezone}\n💼 ${r.desired_position}\n✍️ ${r.motivation}\n` +
        `📅 ${r.submitted_at}\n\n@${r.username||'нет'} | <code>${r.telegram_id}</code>`,
        { parse_mode: 'HTML', ...adminResumeActionMenu(r.id, r.telegram_id) }
      );
    }
    return;
  }

  // ── Список тикетов (панель) ───────────────────────────────
  if (data === 'admin_tickets') {
    if (!isAdmin(userId)) return;
    const tickets = getOpenTickets();
    if (tickets.length === 0) {
      await bot.editMessageText('🆘 <b>Нет открытых тикетов</b>',
        { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', ...adminPanelMenu() }
      );
      return;
    }
    await bot.editMessageText(`🆘 <b>Открытых тикетов: ${tickets.length}</b>`,
      { chat_id: chatId, message_id: msgId, parse_mode: 'HTML' }
    );
    for (const t of tickets.slice(0, 10)) {
      const user = getUser(t.telegram_id);
      await bot.sendMessage(chatId,
        `🆘 <b>Тикет #${t.id}</b>\n\n` +
        `👤 ${user?.full_name||'Неизвестно'} (@${user?.username||'нет'})\n` +
        `🆔 <code>${t.telegram_id}</code>\n📝 ${t.message}\n📅 ${t.created_at}`,
        { parse_mode: 'HTML', ...adminTicketActionMenu(t.id, t.telegram_id) }
      );
    }
    return;
  }

  // ── FAQ ───────────────────────────────────────────────────
  if (data === 'faq_page_1') {
    await bot.editMessageText(FAQ_PAGE_1,
      { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', ...faqMenu }
    );
    return;
  }
  if (data === 'faq_page_2') {
    await bot.editMessageText(FAQ_PAGE_2,
      { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', ...faqPage2Menu }
    );
    return;
  }

  // ── Назад в меню ─────────────────────────────────────────
  if (data === 'back_main') {
    clearState(userId);
    try { await bot.deleteMessage(chatId, msgId); } catch(_) {}
    await sendMain(chatId);
    return;
  }

  // ── Отмена резюме ────────────────────────────────────────
  if (data === 'cancel_resume') {
    clearState(userId);
    try {
      await bot.editMessageText('❌ Подача резюме отменена.',
        { chat_id: chatId, message_id: msgId }
      );
    } catch(_) {}
    await sendMain(chatId);
    return;
  }

  // ── Отмена поддержки ────────────────────────────────────
  if (data === 'cancel_support') {
    clearState(userId);
    try {
      await bot.editMessageText('❌ Обращение отменено.',
        { chat_id: chatId, message_id: msgId }
      );
    } catch(_) {}
    await sendMain(chatId);
    return;
  }
});

// ═══════════════════════════════════════════════════════════
//  Запуск
// ═══════════════════════════════════════════════════════════
(async () => {
  await initDB();
  console.log(`
🩸 ══════════════════════════════════
   КРОВАВЫЙ МЕРИДИАН — Bot
   by ZEUS COMPANY
══════════════════════════════════
✅ Бот запущен!
👑 Администраторы: ${ADMIN_IDS.length ? ADMIN_IDS.join(', ') : 'НЕ ЗАДАНЫ — добавьте в .env'}
══════════════════════════════════
  `);
})();

bot.on('polling_error', (err) => console.error('❌ Polling:', err.message));
