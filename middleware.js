const crypto = require('crypto');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const { Image } = require('./models');

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET) console.warn('JWT_SECRET is not set: admin sessions end whenever the server restarts.');

const upload = multer({
  storage: multer.memoryStorage(),   // keep the file in memory, then save it to MongoDB
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype))
});

// Saves an uploaded image into MongoDB and returns the string to store, e.g. "/api/images/66f..."
async function saveImage(file) {
  const img = await Image.create({ data: file.buffer, contentType: file.mimetype, size: file.size });
  return `/api/images/${img.id}`;
}
// Removes the image behind such a string (ignores anything that is not one of ours)
async function deleteImage(url) {
  const m = /\/api\/images\/([0-9a-f]{24})/i.exec(url || '');
  if (m) await Image.findByIdAndDelete(m[1]);
}

const signToken = () => jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '12h' });
function auth(req, res, next) {
  try { jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Please log in again.' }); }
}

// Lets async route handlers pass errors to Express
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { upload, saveImage, deleteImage, signToken, auth, wrap };
