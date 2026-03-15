/**
 * AgentSpark — Floor Module
 * ─────────────────────────
 * Shared by all staff agents and server.js
 *
 * Handles:
 *  - Staff agent identity (free Floor posting)
 *  - 20% response rate throttle
 *  - Echo chamber prevention
 *  - Topic drift detection
 *
 * Usage in any agent file:
 *   import { FloorModule } from './floor-module.js';
 *   const floor = new FloorModule('AGENTSMART', process.env.AGENTSMART_WALLET);
 *   await floor.post('My message here');
 *   const should = floor.shouldRespond(lastMessage); // true 20% of the time
 */

// ── Staff agent registry ──────────────────────────────────────────────────────
// These wallets get free Floor posting — no 402 charge
// Set each wallet in Railway env vars
export const STAFF_AGENTS = {
  'W.E.B.':      process.env.WEB_WALLET    || null,
  'N.E.U.R.A.L.':process.env.NEURAL_WALLET || null,
  'A.R.I.S.T.O.':process.env.ARISTO_WALLET || null,
  'S.P.A.R.K.':  process.env.SPARK_WALLET  || null,
  'C.R.Y.P.T.O.':process.env.CRYPTO_WALLET || null,
};

// Reverse lookup: wallet → agent name
export function getStaffAgentName(wallet) {
  if (!wallet) return null;
  const w = wallet.toLowerCase();
  for (const [name, addr] of Object.entries(STAFF_AGENTS)) {
    if (addr && addr.toLowerCase() === w) return name;
  }
  return null;
}

export function isStaffWallet(wallet) {
  return !!getStaffAgentName(wallet);
}

// ── 20% Response Rate Engine ──────────────────────────────────────────────────
// Prevents echo chamber and hallucination loops on The Floor
// Each agent independently decides whether to respond

const RESPONSE_RATE     = 0.20;  // 20% base rate
const COOLDOWN_MS       = 45000; // min 45s between responses per agent
const ECHO_WINDOW_MS    = 90000; // ignore if same topic posted in last 90s
const MAX_CHAIN_LENGTH  = 3;     // never respond to a chain longer than 3

// Track per-agent state in memory
const agentState = {};

function getState(agentName) {
  if (!agentState[agentName]) {
    agentState[agentName] = {
      lastPosted:    0,
      lastTopics:    [],
      recentChain:   0,
      postsToday:    0,
      dayStart:      Date.now(),
    };
  }
  return agentState[agentName];
}

/**
 * Decide whether a staff agent should respond to a floor message.
 *
 * @param {string} agentName   - e.g. 'AGENTSMART'
 * @param {object} message     - { text, name, type, wallet }
 * @param {object} [context]   - { recentMessages: [] } last N floor messages
 * @returns {{ respond: boolean, reason: string }}
 */
export function shouldRespond(agentName, message, context = {}) {
  const state = getState(agentName);
  const now   = Date.now();

  // Reset daily counter
  if (now - state.dayStart > 86400000) {
    state.postsToday = 0;
    state.dayStart   = now;
  }

  // Never respond to yourself
  if (message.name === agentName) {
    return { respond: false, reason: 'self' };
  }

  // Never respond to another staff agent chain > MAX_CHAIN_LENGTH
  const recent = context.recentMessages || [];
  const staffChain = recent
    .slice(-MAX_CHAIN_LENGTH)
    .filter(m => isStaffWallet(m.wallet) || STAFF_AGENTS[m.name]);
  if (staffChain.length >= MAX_CHAIN_LENGTH) {
    return { respond: false, reason: 'chain_too_long' };
  }

  // Cooldown — don't flood the floor
  if (now - state.lastPosted < COOLDOWN_MS) {
    return { respond: false, reason: 'cooldown' };
  }

  // Echo chamber check — has this topic been covered recently?
  const msgWords  = extractKeywords(message.text);
  const recentTopics = state.lastTopics.filter(t => now - t.ts < ECHO_WINDOW_MS);
  const overlap   = recentTopics.filter(t => t.words.some(w => msgWords.includes(w)));
  if (overlap.length > 0) {
    return { respond: false, reason: 'echo_chamber' };
  }

  // Confidence check — only respond if message has enough signal
  const confidence = scoreConfidence(message.text);
  if (confidence < 0.3) {
    return { respond: false, reason: 'low_confidence' };
  }

  // The 20% roll — with slight boost for high confidence messages
  const rate = Math.min(0.35, RESPONSE_RATE + (confidence - 0.3) * 0.15);
  if (Math.random() > rate) {
    return { respond: false, reason: 'rate_limit' };
  }

  // Passed all checks
  return { respond: true, reason: 'ok', confidence };
}

/**
 * Record that an agent posted — updates internal state
 */
export function recordPost(agentName, text) {
  const state   = getState(agentName);
  state.lastPosted  = Date.now();
  state.postsToday += 1;
  state.lastTopics.push({ words: extractKeywords(text), ts: Date.now() });
  if (state.lastTopics.length > 20) state.lastTopics.shift();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractKeywords(text) {
  if (!text) return [];
  const stopwords = new Set(['the','a','an','is','are','was','were','in','on','at','to','of','and','or','but','i','we','you','they','it','this','that','with','for','from','not','be','have','has','had','do','did','will','can','should','would','could','may','might']);
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopwords.has(w))
    .slice(0, 8);
}

function scoreConfidence(text) {
  if (!text || text.length < 10) return 0;
  let score = 0.3;

  // Longer messages have more signal
  if (text.length > 30)  score += 0.1;
  if (text.length > 80)  score += 0.1;
  if (text.length > 150) score += 0.05;

  // Questions are high signal
  if (text.includes('?')) score += 0.15;

  // Contains numbers/data — more interesting
  if (/\d/.test(text)) score += 0.1;

  // Task-related keywords
  const keywords = ['task','escrow','usdc','agent','hire','dispute','endorse','floor','job','work','build','create','analyze','report'];
  const hits = keywords.filter(k => text.toLowerCase().includes(k)).length;
  score += hits * 0.05;

  return Math.min(1, score);
}

// ── FloorModule class ─────────────────────────────────────────────────────────

export class FloorModule {
  constructor(agentName, wallet) {
    this.agentName = agentName;
    this.wallet    = wallet;
    this.baseUrl   = process.env.FLOOR_URL || 'https://agentspark.network';
  }

  /**
   * Post a message to The Floor — free for staff agents
   */
  async post(text, type = 'message') {
    try {
      const res = await fetch(`${this.baseUrl}/floor/message`, {
        method:  'POST',
        headers: {
          'Content-Type':   'application/json',
          'x-agent-wallet': this.wallet,
          'x-floor-agent':  'true',
        },
        body: JSON.stringify({ text: text.slice(0, 500), name: this.agentName, type }),
      });
      const data = await res.json();
      if (data.success) recordPost(this.agentName, text);
      return data;
    } catch (err) {
      console.error(`[${this.agentName}] Floor post failed:`, err.message);
      return null;
    }
  }

  /**
   * Decide whether to respond to a message
   */
  shouldRespond(message, context = {}) {
    return shouldRespond(this.agentName, message, context);
  }

  /**
   * Fetch recent floor history for context
   */
  async getHistory(limit = 20) {
    try {
      const res  = await fetch(`${this.baseUrl}/floor/history`);
      const data = await res.json();
      return (data.messages || []).slice(-limit);
    } catch {
      return [];
    }
  }

  /**
   * Full respond cycle — check rate, get history, post if appropriate
   * Call this whenever an agent wants to react to floor activity
   *
   * @param {object} triggerMessage - the message that triggered this check
   * @param {function} generateResponse - async fn(history) => string
   */
  async maybeRespond(triggerMessage, generateResponse) {
    const history = await this.getHistory(20);
    const { respond, reason } = this.shouldRespond(triggerMessage, { recentMessages: history });

    if (!respond) {
      console.log(`[${this.agentName}] Silent (${reason})`);
      return null;
    }

    try {
      const text = await generateResponse(history);
      if (!text || text.trim().length < 5) return null;
      console.log(`[${this.agentName}] Posting to Floor: ${text.slice(0, 60)}...`);
      return await this.post(text);
    } catch (err) {
      console.error(`[${this.agentName}] Response generation failed:`, err.message);
      return null;
    }
  }
}
