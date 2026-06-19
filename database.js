const initSqlJs = require('sql.js');
const fs   = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'meridian.db');
let db = null;

async function initDB() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY,
    telegram_id  INTEGER UNIQUE NOT NULL,
    username     TEXT,
    full_name    TEXT,
    registered_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS resumes (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id      INTEGER NOT NULL,
    username         TEXT,
    full_name        TEXT,
    name             TEXT,
    age              INTEGER,
    phone            TEXT,
    timezone         TEXT,
    desired_position TEXT,
    motivation       TEXT,
    status           TEXT DEFAULT 'pending',
    submitted_at     TEXT DEFAULT (datetime('now')),
    reviewed_by      INTEGER,
    reviewed_at      TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS support_tickets (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL,
    message    TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    status     TEXT DEFAULT 'open',
    taken_by   INTEGER,
    closed_at  TEXT
  )`);

  saveDB();
  console.log('✅ База данных инициализирована');
  return db;
}

function saveDB() {
  if (!db) return;
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

// ── USERS ────────────────────────────────────────────────────────
function upsertUser(user) {
  db.run(
    `INSERT INTO users (telegram_id, username, full_name, registered_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(telegram_id) DO UPDATE SET
       username  = excluded.username,
       full_name = excluded.full_name`,
    [user.id, user.username || null,
     user.first_name + (user.last_name ? ' ' + user.last_name : '')]
  );
  saveDB();
}

function getUser(telegramId) {
  const s = db.prepare('SELECT * FROM users WHERE telegram_id = ?');
  s.bind([telegramId]);
  return s.step() ? s.getAsObject() : null;
}

// ── RESUMES ──────────────────────────────────────────────────────
function createResume(data) {
  db.run(
    `INSERT INTO resumes
       (telegram_id,username,full_name,name,age,phone,timezone,desired_position,motivation)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [data.telegram_id, data.username, data.full_name,
     data.name, data.age, data.phone,
     data.timezone, data.desired_position, data.motivation]
  );
  saveDB();
  const s = db.prepare('SELECT last_insert_rowid() as id');
  s.step();
  return s.getAsObject().id;
}

// Есть ли у пользователя резюме со статусом pending
function hasPendingResume(telegramId) {
  const s = db.prepare(
    "SELECT id FROM resumes WHERE telegram_id = ? AND status = 'pending' LIMIT 1"
  );
  s.bind([telegramId]);
  return s.step();
}

function getPendingResumes() {
  const s = db.prepare("SELECT * FROM resumes WHERE status='pending' ORDER BY submitted_at DESC");
  const r = [];
  while (s.step()) r.push(s.getAsObject());
  return r;
}

function updateResumeStatus(resumeId, status, reviewerId) {
  db.run(
    `UPDATE resumes SET status=?, reviewed_by=?, reviewed_at=datetime('now') WHERE id=?`,
    [status, reviewerId, resumeId]
  );
  saveDB();
}

function getResumeById(resumeId) {
  const s = db.prepare('SELECT * FROM resumes WHERE id = ?');
  s.bind([resumeId]);
  return s.step() ? s.getAsObject() : null;
}

// ── TICKETS ──────────────────────────────────────────────────────
function createTicket(telegramId, message) {
  db.run('INSERT INTO support_tickets (telegram_id,message) VALUES (?,?)',
    [telegramId, message]);
  saveDB();
  const s = db.prepare('SELECT last_insert_rowid() as id');
  s.step();
  return s.getAsObject().id;
}

// Есть ли у пользователя открытый/принятый тикет
function hasActiveTicket(telegramId) {
  const s = db.prepare(
    "SELECT id FROM support_tickets WHERE telegram_id=? AND status IN ('open','taken') LIMIT 1"
  );
  s.bind([telegramId]);
  return s.step() ? s.getAsObject() : null;
}

function getOpenTickets() {
  const s = db.prepare("SELECT * FROM support_tickets WHERE status='open' ORDER BY created_at DESC");
  const r = [];
  while (s.step()) r.push(s.getAsObject());
  return r;
}

function getTicketById(ticketId) {
  const s = db.prepare('SELECT * FROM support_tickets WHERE id=?');
  s.bind([ticketId]);
  return s.step() ? s.getAsObject() : null;
}

function takeTicket(ticketId, adminId) {
  db.run("UPDATE support_tickets SET status='taken', taken_by=? WHERE id=?",
    [adminId, ticketId]);
  saveDB();
}

function closeTicket(ticketId) {
  db.run("UPDATE support_tickets SET status='closed', closed_at=datetime('now') WHERE id=?",
    [ticketId]);
  saveDB();
}

module.exports = {
  initDB, saveDB,
  upsertUser, getUser,
  createResume, hasPendingResume, getPendingResumes, updateResumeStatus, getResumeById,
  createTicket, hasActiveTicket, getOpenTickets, getTicketById, takeTicket, closeTicket
};