require('dotenv').config();
const app = require('./src/app');

// ponytail: Node kills the whole process on any unhandled promise rejection
// by default — a single stray error in a background job (not a request, so
// express-async-errors can't catch it) would otherwise take the server down
// for every user. Log instead of crashing.
process.on('unhandledRejection', err => console.error('[unhandledRejection]', err));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
