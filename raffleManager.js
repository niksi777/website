let raffleOpen = false;
let entrants = new Set();
let winners = [];
let raffleTimer = null;
let sendMessageFn = null; // injected from kickBot.js

function getWinnerCount(entrantCount) {
  if (entrantCount >= 10) return 4;
  if (entrantCount >= 6) return 3;
  return 2;
}

function drawWinners() {
  raffleOpen = false;
  const pool = Array.from(entrants);

  if (pool.length === 0) {
    if (sendMessageFn) sendMessageFn('The raffle ended but nobody joined. SadChamp');
    entrants.clear();
    winners = [];
    return;
  }

  const count = Math.min(getWinnerCount(pool.length), pool.length);
  const shuffled = pool.sort(() => Math.random() - 0.5);
  winners = shuffled.slice(0, count);

  const mention = winners.map(w => `@${w}`).join(', ');
  if (sendMessageFn) sendMessageFn(`🎉 Raffle over! Congratulations to the ${count} winner(s): ${mention}!`);

  entrants.clear();
}

function openRaffle(send) {
  if (raffleOpen) return { success: false, message: 'A raffle is already running!' };
  raffleOpen = true;
  entrants.clear();
  winners = [];
  sendMessageFn = send;

  send('🎟️ A multiraffle has started! Type !join to participate. Drawing winners in 30 seconds!');

  raffleTimer = setTimeout(() => {
    drawWinners();
  }, 30000);

  return { success: true };
}

function joinRaffle(username) {
  if (!raffleOpen) return { success: false };
  const user = username.toLowerCase();
  if (entrants.has(user)) return { success: false }; // already in, silent
  entrants.add(user);
  return { success: true };
}

function getRaffleStatus() {
  return { open: raffleOpen, entrantCount: entrants.size, lastWinners: winners };
}

function cancelRaffle() {
  if (!raffleOpen) return { success: false, message: 'No raffle is running.' };
  clearTimeout(raffleTimer);
  raffleOpen = false;
  entrants.clear();
  return { success: true, message: 'Raffle cancelled.' };
}

module.exports = { openRaffle, joinRaffle, getRaffleStatus, cancelRaffle };
