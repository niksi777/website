const fs = require('fs');
const path = require('path');

const POINTS_FILE = path.join(__dirname, 'points.json');

function loadPoints() {
  if (!fs.existsSync(POINTS_FILE)) {
    fs.writeFileSync(POINTS_FILE, JSON.stringify({}), 'utf8');
  }
  try {
    return JSON.parse(fs.readFileSync(POINTS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function savePoints(data) {
  fs.writeFileSync(POINTS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function getPoints(username) {
  const data = loadPoints();
  return data[username.toLowerCase()] || 0;
}

function setPoints(username, amount) {
  const data = loadPoints();
  data[username.toLowerCase()] = Math.max(0, Math.floor(amount));
  savePoints(data);
  return data[username.toLowerCase()];
}

function addPoints(username, amount) {
  return setPoints(username, getPoints(username) + amount);
}

function deductPoints(username, amount) {
  const current = getPoints(username);
  if (current < amount) return null; // not enough points
  return setPoints(username, current - amount);
}

function getAllPoints() {
  return loadPoints();
}

function getLeaderboard(limit = 10) {
  const data = loadPoints();
  return Object.entries(data)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([username, points], i) => ({ rank: i + 1, username, points }));
}

module.exports = { getPoints, setPoints, addPoints, deductPoints, getAllPoints, getLeaderboard };
