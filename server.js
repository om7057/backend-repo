const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Configure CORS to allow requests from the deployed frontend and local dev
const allowedOrigins = [
  'https://nptel-tau.vercel.app', // hosted frontend
  'https://nptel-tau.vercel.app/',
  'http://localhost:3000', // local dev when using `npm start` or `serve`
  'http://127.0.0.1:3000'
];

app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (like server-to-server or curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      return callback(null, true);
    } else {
      return callback(new Error('CORS policy: This origin is not allowed'), false);
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));
app.use(express.json());

// Helper to check mongoose connection state
function isDbConnected() {
  // 0 disconnected, 1 connected, 2 connecting, 3 disconnecting
  return mongoose.connection && mongoose.connection.readyState === 1;
}

// Return 503 for any /api requests when DB isn't ready to prevent 500s
app.use('/api', (req, res, next) => {
  if (!isDbConnected()) {
    return res.status(503).json({ message: 'Service unavailable - database not ready' });
  }
  next();
});

// ✅ Connect to MongoDB Atlas
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('✅ MongoDB Connected'))
.catch(err => console.error('MongoDB Connection Error:', err));

const userSchema = new mongoose.Schema({
  username: String,
  password: String,
  // scores will store best scores per section, e.g. { "PYQ": 5, "Assignment": 3 }
  scores: { type: Map, of: Number, default: {} },
});

const User = mongoose.model('User', userSchema);

// ✅ Fixed questions
const questions = [
  { q: "Capital of France?", options: ["Paris", "London", "Berlin"], answer: "Paris" },
  { q: "2 + 2 = ?", options: ["3", "4", "5"], answer: "4" },
  { q: "Color of the sky?", options: ["Blue", "Red", "Green"], answer: "Blue" },
];

// ✅ Login / Signup
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    let user = await User.findOne({ username });

    if (!user) {
      user = new User({ username, password });
      await user.save();
    }

    if (user.password !== password) {
      return res.status(401).json({ message: 'Invalid password' });
    }

    res.json(user);
  } catch (err) {
    console.error('Error in /api/login:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ✅ Get Questions
app.get('/api/questions', (req, res) => {
  const reveal = req.query.reveal === 'true';
  if (reveal) {
    // include answers for client-side immediate feedback (practice mode)
    return res.json(questions);
  }
  // hide correct answers by default
  res.json(questions.map(({ answer, ...rest }) => rest));
});

// ✅ Submit Answers
app.post('/api/submit', async (req, res) => {
  try {
    const { username, answers, section } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Accept client-provided score if present (we trust the client in this mode).
    // Fallback: compute score server-side if score not provided.
    let score = typeof req.body.score === 'number' ? req.body.score : 0;
    if (typeof req.body.score !== 'number') {
      for (let i = 0; i < questions.length; i++) {
        if (answers && answers[i] === questions[i].answer) score++;
      }
    }

    const sect = section || 'default';

    const current = user.scores.get(sect) || 0;
    if (score > current) {
      user.scores.set(sect, score);
      await user.save();
    }

    res.json({ score: user.scores.get(sect) });
  } catch (err) {
    console.error('Error in /api/submit:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ✅ Leaderboard
app.get('/api/leaderboard', async (req, res) => {
  try {
    // support ?section=SECTION_NAME to get per-section leaderboard
    const section = req.query.section || 'default';

    // Retrieve all users and their score for the requested section, sort descending
    const users = await User.find().select('username scores');
    const list = users.map(u => ({ username: u.username, score: (u.scores && u.scores.get(section)) || 0 }));
    list.sort((a, b) => b.score - a.score);
    res.json(list);
  } catch (err) {
    console.error('Error in /api/leaderboard:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Health check route for cron / monitoring
app.get('/health', (req, res) => {
  res.json({ ok: true, db: isDbConnected() ? 'connected' : 'disconnected' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
