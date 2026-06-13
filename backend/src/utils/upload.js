const multer = require('multer');
const path = require('path');

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_FILES = 5;

// Whitelist of extensions allowed for order/chat attachments.
const ALLOWED_EXT = new Set([
  '.pdf', '.doc', '.docx', '.txt', '.rtf', '.odt', '.md',
  '.xls', '.xlsx', '.csv', '.ods',
  '.ppt', '.pptx', '.odp',
  '.zip', '.rar', '.7z',
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.bmp', '.svg',
]);

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    const e = new Error('Недопустимый тип файла');
    e.status = 400;
    return cb(e);
  }
  cb(null, true);
}

// Builds a multer instance with size/count limits and a type whitelist.
function makeUploader() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
    fileFilter,
  });
}

module.exports = { makeUploader, MAX_FILE_SIZE, MAX_FILES };
