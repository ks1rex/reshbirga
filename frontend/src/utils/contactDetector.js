const PATTERNS = [
  // Russian phone numbers: +7 or 8 + 10 digits in various formats
  /(?:\+7|8)[\s\-.(]?\(?\d{3}\)?[\s\-.)]?\d{3}[\s\-.]?\d{2}[\s\-.]?\d{2}/,
  // Generic international phones (7+ digits with separators)
  /\b\d[\d\s\-().]{6,}\d\b/,
  // Email addresses
  /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/,
  // Telegram handle (@username, 5+ chars)
  /@[a-zA-Z][a-zA-Z0-9_]{4,}/,
  // Telegram links
  /t(?:elegram)?\.me\/[a-zA-Z0-9_]+/i,
  // Social networks and messengers
  /(?:whatsapp|viber|вотсап|telegram|телеграм|вконтакте|vk\.com|vk\.ru|instagram|инстаграм?|discord(?:\.gg)?|snapchat|tiktok|ватсап)/i,
];

export function detectContactInfo(text) {
  return PATTERNS.some(p => p.test(text));
}
