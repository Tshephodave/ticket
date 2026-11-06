require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');

const PORT = process.env.PORT || 3000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';

const app = express();
app.set('trust proxy', 1);

// CORS: lets the separate front-end call this API
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', FRONTEND_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json());

app.get('/', (req, res) => res.json({ service: 'Ola tickets API', status: 'running' }));
app.get('/api/health', (req, res) => res.json({ ok: true, database: mongoose.connection.readyState === 1 }));
app.use('/api', require('./routes/public'));
app.use('/api/admin', require('./routes/admin'));

app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'That image is too large (8 MB maximum).' });
  if (err.name === 'CastError' || err.name === 'ValidationError') return res.status(400).json({ error: 'Invalid request.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI is missing. Copy .env.example to .env and set it.'); process.exit(1); }
mongoose.connect(uri)
  .then(() => app.listen(PORT, () => console.log(`Ola tickets API running on http://localhost:${PORT}`)))
  .catch((e) => { console.error('Could not connect to MongoDB:', e.message); process.exit(1); });
