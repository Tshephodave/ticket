const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const jwt = require('jsonwebtoken');

const UPLOADS = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET) console.warn('JWT_SECRET is not set: admin sessions end whenever the server restarts.');

const uid = () => crypto.randomBytes(5).toString('hex');
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS,
    filename: (req, file, cb) => cb(null, uid() + path.extname(file.originalname).toLowerCase())
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype))
});

// Public address of this API, used to build image links. Set PUBLIC_URL when deployed.
const fileUrl = (req, name) => `${(process.env.PUBLIC_URL || req.protocol + '://' + req.get('host')).replace(/\/$/, '')}/uploads/${name}`;

const signToken = () => jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '12h' });
function auth(req, res, next) {
  try { jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Please log in again.' }); }
}

// Lets async route handlers pass errors to Express
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { UPLOADS, upload, fileUrl, signToken, auth, wrap };
