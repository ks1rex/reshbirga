const PATTERNS = [
  // Russian phones: +7 or 8 prefix with 10 digits and any separators
  /(?:\+7|8)[\s\-.(]?\(?\d{3}\)?[\s\-.)]?\d{3}[\s\-.]?\d{2}[\s\-.]?\d{2}/,
  // Bare Russian mobile starting with 9 (9XX-XXX-XX-XX)
  /\b9\d{2}[\s\-.]?\d{3}[\s\-.]?\d{2}[\s\-.]?\d{2}\b/,
  // Generic 7-15 digit sequence with separators (catches most phone formats)
  /\b\d[\d\s\-().]{5,14}\d\b/,
  // Email addresses
  /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/,
  // @username: any Latin/Cyrillic/digit/underscore handle, 2-32 chars (any social/messenger)
  /@[a-zA-Zа-яА-ЯёЁ0-9_]{2,32}/,
  // Telegram links
  /t(?:elegram)?\.me\/[a-zA-Z0-9_]+/i,
  // Social networks and messengers
  /(?:whatsapp|viber|вотсап|ватсап|telegram|телеграм|вконтакте|vk\.com|vk\.ru|instagram|инстаграм?|discord(?:\.gg)?|snapchat|tiktok|signal|skype|скайп|вайбер)/i,
];

function detectContactInfo(text) {
  return PATTERNS.some(p => p.test(text));
}

module.exports = { detectContactInfo };
