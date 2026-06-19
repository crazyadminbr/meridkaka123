const mainMenu = {
  reply_markup: {
    keyboard: [
      [{ text: '👤 Профиль' }, { text: '❓ FAQ' }],
      [{ text: '📝 Подача резюме' }],
      [{ text: '🆘 Поддержка' }]
    ],
    resize_keyboard: true
  }
};

const profileMenu = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '🔙 Назад', callback_data: 'back_main' }]
    ]
  }
};

const faqMenu = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '➡️ Далее (стр. 2)', callback_data: 'faq_page_2' }],
      [{ text: '🔙 Назад', callback_data: 'back_main' }]
    ]
  }
};

const faqPage2Menu = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '⬅️ Назад (стр. 1)', callback_data: 'faq_page_1' }],
      [{ text: '🏠 Главное меню', callback_data: 'back_main' }]
    ]
  }
};

const cancelResume = {
  reply_markup: {
    inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'cancel_resume' }]]
  }
};

const cancelSupport = {
  reply_markup: {
    inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'cancel_support' }]]
  }
};

const sharePhoneKeyboard = {
  reply_markup: {
    keyboard: [[{ text: '📞 Поделиться номером телефона', request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true
  }
};

// Уведомление о новом резюме — только кнопка написать
function adminResumeMenu(resumeId, telegramId, username) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '💬 Написать соискателю', url: `tg://user?id=${telegramId}` }]
      ]
    }
  };
}

// Кнопки принять/отклонить — только в панели /admin
function adminResumeActionMenu(resumeId, telegramId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Принять',    callback_data: `resume_accept_${resumeId}` },
          { text: '❌ Отклонить', callback_data: `resume_reject_${resumeId}` }
        ],
        [{ text: '💬 Написать соискателю', url: `tg://user?id=${telegramId}` }]
      ]
    }
  };
}

// Уведомление о новом тикете — только кнопка написать
function adminTicketMenu(ticketId, telegramId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '💬 Написать пользователю', url: `tg://user?id=${telegramId}` }]
      ]
    }
  };
}

// Кнопка принять тикет — только в панели /admin
function adminTicketActionMenu(ticketId, telegramId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🙋 Принять тикет', callback_data: `ticket_take_${ticketId}` }],
        [{ text: '💬 Написать пользователю', url: `tg://user?id=${telegramId}` }]
      ]
    }
  };
}

function activeTicketMenu(ticketId, telegramId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '✅ Закрыть тикет', callback_data: `ticket_close_${ticketId}` }],
        [{ text: '💬 Написать пользователю', url: `tg://user?id=${telegramId}` }]
      ]
    }
  };
}

function adminPanelMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📋 Новые резюме', callback_data: 'admin_resumes' }],
        [{ text: '🆘 Открытые тикеты', callback_data: 'admin_tickets' }]
      ]
    }
  };
}

module.exports = {
  mainMenu, profileMenu, faqMenu, faqPage2Menu,
  cancelResume, cancelSupport, sharePhoneKeyboard,
  adminResumeMenu, adminResumeActionMenu,
  adminTicketMenu, adminTicketActionMenu,
  activeTicketMenu, adminPanelMenu
};