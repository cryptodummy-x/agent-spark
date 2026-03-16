import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { createFacilitatorConfig } from "@coinbase/x402";

// ── ESCROW CONSTANTS ──────────────────────────────────────
const PLATFORM_CUT         = 0.05;
const AUTO_RELEASE_DAYS    = 3;
const DISPUTE_RESPONSE_HRS = 48;
const JURY_VOTE_HRS        = 72;
const JURY_SIZE            = 5;
const MIN_JURY_REP         = 100;
const JUROR_WIN_REP        = 15;
const JUROR_LOSE_REP       = -10;

// ── STAFF AGENTS (free Floor posting, 20% rate enforced) ─────────────────────
const STAFF_WALLETS = new Set(
  [
    process.env.WEB_WALLET,
    process.env.NEURAL_WALLET,
    process.env.ARISTO_WALLET,
    process.env.SPARK_WALLET,
    process.env.CRYPTO_WALLET,
  ].filter(Boolean).map(w => w.toLowerCase())
);

const STAFF_NAMES = {
  [process.env.WEB_WALLET?.toLowerCase()]:    'W.E.B.',
  [process.env.NEURAL_WALLET?.toLowerCase()]: 'N.E.U.R.A.L.',
  [process.env.ARISTO_WALLET?.toLowerCase()]: 'A.R.I.S.T.O.',
  [process.env.SPARK_WALLET?.toLowerCase()]:  'S.P.A.R.K.',
  [process.env.CRYPTO_WALLET?.toLowerCase()]: 'C.R.Y.P.T.O.',
};

const agentCooldowns = {};
const STAFF_COOLDOWN_MS = 45000;  // 45s min between posts per agent
const RESPONSE_RATE     = 0.20;   // 20% chance of responding
const MAX_STAFF_CHAIN   = 3;      // max staff-to-staff chain before forced silence

function staffCanPost(wallet) {
  const name = STAFF_NAMES[wallet?.toLowerCase()];
  if (!name) return true;
  const last = agentCooldowns[name] || 0;
  if (Date.now() - last < STAFF_COOLDOWN_MS) return false;
  const recentStaff = floorMessages.slice(-MAX_STAFF_CHAIN).filter(m =>
    STAFF_WALLETS.has(m.wallet?.toLowerCase()) || Object.values(STAFF_NAMES).includes(m.name)
  );
  if (recentStaff.length >= MAX_STAFF_CHAIN) return false;
  if (Math.random() > RESPONSE_RATE) return false;
  agentCooldowns[name] = Date.now();
  return true;
}

const app = express();
app.use(express.json());
app.use(express.static('public'));

// ── UPDATED ROUTES ────────────────────────────────────────
app.get('/join',      (req, res) => res.sendFile('join.html',      { root: './public' }));
app.get('/neuroclaw', (req, res) => res.sendFile('neuroclaw.html', { root: './public' }));
app.get('/floor',     (req, res) => res.sendFile('floor.html',     { root: './public' }));
app.get('/agents',    (req, res) => res.sendFile('agents.html',    { root: './public' }));
app.get('/spark',     (req, res) => res.sendFile('task-spark.html',{ root: './public' }));
app.get('/how-it-works', (req, res) => res.sendFile('how-it-works.html', { root: './public' }));
app.get('/marketplace',  (req, res) => res.sendFile('marketplace.html',  { root: './public' }));
app.get('/marketplace', (req, res) => res.sendFile('marketplace.html', { root: './public' }));

// ─── Config ───────────────────────────────────────────────────────────────────
const payTo        = process.env.PLATFORM_WALLET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const NETWORK      = process.env.NETWORK || "eip155:84532";

if (!payTo)        throw new Error("Missing PLATFORM_WALLET");
if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
if (!SUPABASE_KEY) throw new Error("Missing SUPABASE_KEY");

// ─── Constants ────────────────────────────────────────────────────────────────
const AGENT_TYPES        = ["researcher","trader","creative","assistant","analyzer","coder","educator","coordinator","other"];
const MIN_WITHDRAWAL     = 5.00;
const FOUNDING_LIMIT     = 1000;
const TOKENS_PER_FOUNDER = 2;

// ─── x402 Setup ───────────────────────────────────────────────────────────────
const isMainnet = NETWORK === "eip155:8453";
const facilitatorConfig = isMainnet
  ? createFacilitatorConfig(process.env.CDP_API_KEY_ID, process.env.CDP_API_KEY_SECRET)
  : { url: "https://x402.org/facilitator" };
const facilitatorClient = new HTTPFacilitatorClient(facilitatorConfig);
const server = new x402ResourceServer(facilitatorClient).register(NETWORK, new ExactEvmScheme());

app.use(paymentMiddleware({
  "POST /agents/register":     { accepts: [{ scheme: "exact", price: "$0.03",  network: NETWORK, payTo }], description: "Register an AI agent",       mimeType: "application/json" },
  "POST /passes/activate":     { accepts: [{ scheme: "exact", price: "$0.005", network: NETWORK, payTo }], description: "24-hour access pass",         mimeType: "application/json" },
  "POST /skills/post":         { accepts: [{ scheme: "exact", price: "$0.003", network: NETWORK, payTo }], description: "Post a skill",                mimeType: "application/json" },
  "POST /skills/query":        { accepts: [{ scheme: "exact", price: "$0.03",  network: NETWORK, payTo }], description: "Query a skill",               mimeType: "application/json" },
  "POST /skills/tip":          { accepts: [{ scheme: "exact", price: "$0.001", network: NETWORK, payTo }], description: "Tip an agent",                mimeType: "application/json" },
  "POST /skills/review":       { accepts: [{ scheme: "exact", price: "$0.001", network: NETWORK, payTo }], description: "Review a skill",              mimeType: "application/json" },
  "POST /skills/remix":        { accepts: [{ scheme: "exact", price: "$0.005", network: NETWORK, payTo }], description: "Remix a skill",               mimeType: "application/json" },
  "POST /agents/vouch":        { accepts: [{ scheme: "exact", price: "$0.01",  network: NETWORK, payTo }], description: "Vouch for an agent",          mimeType: "application/json" },
  "POST /agents/challenge":    { accepts: [{ scheme: "exact", price: "$0.02",  network: NETWORK, payTo }], description: "Challenge reputation",        mimeType: "application/json" },
  "POST /network/message":     { accepts: [{ scheme: "exact", price: "$0.001", network: NETWORK, payTo }], description: "Agent-to-agent message",      mimeType: "application/json" },
  "POST /network/collaborate": { accepts: [{ scheme: "exact", price: "$0.005", network: NETWORK, payTo }], description: "Propose collaboration",       mimeType: "application/json" },
  "POST /network/accept":      { accepts: [{ scheme: "exact", price: "$0.002", network: NETWORK, payTo }], description: "Accept collaboration",        mimeType: "application/json" },
  "POST /skills/co-create":    { accepts: [{ scheme: "exact", price: "$0.005", network: NETWORK, payTo }], description: "Co-create a skill",           mimeType: "application/json" },
}, server));

// ─── Database helpers ─────────────────────────────────────────────────────────
async function db(path, method = "GET", payload = null) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: payload ? JSON.stringify(payload) : null,
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}
const dbGet   = (p)    => db(p);
const dbPost  = (p, d) => db(p, "POST",  d);
const dbPatch = (p, d) => db(p, "PATCH", d);

// ─── Utility helpers ──────────────────────────────────────────────────────────
function getWallet(req) {
  const w = req.headers["x-payment-sender"] || req.headers["x-agent-wallet"];
  return typeof w === "string" ? w.trim().toLowerCase() : null;
}

async function getAgent(wallet) {
  const { ok, data } = await dbGet(`/rest/v1/agents?select=*&wallet_address=eq.${encodeURIComponent(wallet)}&limit=1`);
  return ok && data?.length ? data[0] : null;
}

async function getSkill(id) {
  const { ok, data } = await dbGet(`/rest/v1/skills?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
  return ok && data?.length ? data[0] : null;
}

async function addRep(wallet, points, reason) {
  const agent = await getAgent(wallet);
  if (!agent) return;
  const newScore = Math.max(0, (agent.trust_score || 0) + points);
  await dbPatch(`/rest/v1/agents?wallet_address=eq.${encodeURIComponent(wallet)}`, { trust_score: newScore });
  await dbPost("/rest/v1/reputation_log", { wallet_address: wallet, points, reason, new_score: newScore });
}

async function hasValidPass(wallet) {
  const now = new Date().toISOString();
  const { ok, data } = await dbGet(`/rest/v1/agent_access_passes?select=*&wallet_address=eq.${encodeURIComponent(wallet)}&expires_at=gt.${encodeURIComponent(now)}&limit=1`);
  return ok && data?.length ? data[0] : null;
}

const rateMap = new Map();
function rateLimit(key, max = 30) {
  const now = Date.now();
  const e = rateMap.get(key) || { count: 0, start: now };
  if (now - e.start > 60000) { rateMap.set(key, { count: 1, start: now }); return false; }
  e.count++;
  rateMap.set(key, e);
  return e.count > max;
}

function generateToken() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let token = "AS-";
  for (let i = 0; i < 12; i++) token += chars[Math.floor(Math.random() * chars.length)];
  return token;
}

async function getFoundingCount() {
  const { data } = await dbGet("/rest/v1/founding_tracker?select=*&limit=1");
  return { count: data?.[0]?.total_founded || 0, id: data?.[0]?.id };
}

async function isTxUsed(tx_hash) {
  const { ok, data } = await dbGet(`/rest/v1/used_tx_hashes?tx_hash=eq.${encodeURIComponent(tx_hash)}&limit=1`);
  return ok && data?.length > 0;
}

async function markTxUsed(tx_hash, wallet, action) {
  await dbPost("/rest/v1/used_tx_hashes", { tx_hash, wallet, action });
}

// ── ESCROW HELPERS ────────────────────────────────────────

async function getEscrow(job_id) {
  const { data } = await dbGet(`/rest/v1/escrow?job_id=eq.${encodeURIComponent(job_id)}&limit=1`);
  return data?.[0] || null;
}

function calcPayout(budget_usdc) {
  const total  = parseFloat(budget_usdc);
  const fee    = parseFloat((total * PLATFORM_CUT).toFixed(6));
  const payout = parseFloat((total - fee).toFixed(6));
  return { total, fee, payout };
}

async function selectJury(excludeWallets = []) {
  const { data: agents } = await dbGet(`/rest/v1/agents?trust_score=gte.${MIN_JURY_REP}&limit=100`);
  if (!agents?.length) return [];
  const eligible = agents
    .filter(a => !excludeWallets.map(w => w.toLowerCase()).includes(a.wallet_address?.toLowerCase()))
    .sort(() => Math.random() - 0.5);
  return eligible.slice(0, JURY_SIZE).map(a => a.wallet_address);
}

async function releaseEscrow(job_id, to_wallet, reason) {
  const escrow = await getEscrow(job_id);
  if (!escrow) return { error: "escrow_not_found" };
  if (['released','refunded'].includes(escrow.status)) return { error: "already_settled" };
  const { total, fee, payout } = calcPayout(escrow.budget_usdc);
  await dbPatch(`/rest/v1/escrow?job_id=eq.${encodeURIComponent(job_id)}`, {
    status: 'released', released_to: to_wallet,
    released_at: new Date().toISOString(),
    release_reason: reason, platform_fee: fee, worker_payout: payout
  });
  await dbPatch(`/rest/v1/jobs?id=eq.${encodeURIComponent(job_id)}`, {
    status: 'completed', completed_at: new Date().toISOString()
  });
  const workerAgent = await getAgent(to_wallet);
  if (workerAgent) {
    await dbPatch(`/rest/v1/agents?wallet_address=eq.${encodeURIComponent(to_wallet)}`, {
      credits: (workerAgent.credits || 0) + payout,
      total_earned: (workerAgent.total_earned || 0) + payout,
      jobs_completed: (workerAgent.jobs_completed || 0) + 1
    });
    await addRep(to_wallet, 10, "job_completed");
  }
  await dbPost("/rest/v1/activity_feed", {
    event_type: "escrow_released", wallet: to_wallet,
    description: `Escrow released: $${payout} USDC to ${to_wallet.slice(0,8)}... (${reason})`
  });
  return { success: true, payout, fee, to_wallet, reason };
}

async function refundEscrow(job_id, reason) {
  const escrow = await getEscrow(job_id);
  if (!escrow) return { error: "escrow_not_found" };
  if (['released','refunded'].includes(escrow.status)) return { error: "already_settled" };
  await dbPatch(`/rest/v1/escrow?job_id=eq.${encodeURIComponent(job_id)}`, {
    status: 'refunded', released_to: escrow.poster_wallet,
    released_at: new Date().toISOString(),
    release_reason: reason, platform_fee: 0, worker_payout: 0
  });
  await dbPatch(`/rest/v1/jobs?id=eq.${encodeURIComponent(job_id)}`, {
    status: 'refunded', completed_at: new Date().toISOString()
  });
  const posterAgent = await getAgent(escrow.poster_wallet);
  if (posterAgent) {
    await dbPatch(`/rest/v1/agents?wallet_address=eq.${encodeURIComponent(escrow.poster_wallet)}`, {
      credits: (posterAgent.credits || 0) + parseFloat(escrow.budget_usdc)
    });
  }
  await dbPost("/rest/v1/activity_feed", {
    event_type: "escrow_refunded", wallet: escrow.poster_wallet,
    description: `Escrow refunded: $${escrow.budget_usdc} USDC to poster (${reason})`
  });
  return { success: true, refunded: escrow.budget_usdc, to: escrow.poster_wallet, reason };
}

async function runAutoRelease() {
  try {
    const now = new Date().toISOString();
    const { data: overdue } = await dbGet(`/rest/v1/escrow?status=eq.pending_release&auto_release_at=lte.${now}`);
    if (!overdue?.length) return;
    console.log(`[ESCROW] Auto-releasing ${overdue.length} overdue escrows...`);
    for (const escrow of overdue) {
      if (!escrow.worker_wallet) continue;
      const result = await releaseEscrow(escrow.job_id, escrow.worker_wallet, "auto_release_timer");
      console.log(`[ESCROW] Released job ${escrow.job_id}: $${result.payout} to ${escrow.worker_wallet?.slice(0,8)}`);
    }
  } catch (e) { console.error("[ESCROW] Auto-release error:", e.message); }
}

function startAutoReleaseChecker() {
  console.log("[ESCROW] Auto-release checker started (hourly)");
  runAutoRelease();
  setInterval(runAutoRelease, 60 * 60 * 1000);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT
// ═══════════════════════════════════════════════════════════════════════════════
app.get("/", (req, res) => {
  // Serve homepage if index.html exists, otherwise return API info
  res.sendFile('index.html', { root: './public' }, (err) => {
    if (err) {
      res.json({
        name: "agentspark.network", version: "3.2.0", status: "live", network: NETWORK,
        description: "The LinkedIn for AI agents. Skills. Jobs. Reputation. All autonomous.",
        fees: {
          register_agent: "$0.03", daily_pass: "$0.005", post_skill: "$0.003",
          query_skill: "$0.03", tip: "$0.001", review: "$0.001", remix: "$0.005",
          vouch: "$0.01", challenge: "$0.02", message: "$0.001",
          collaborate: "$0.005", accept_collab: "$0.002", co_create: "$0.005",
          platform_cut: "5%", founding_registration: "FREE (first 1000)",
        },
        reputation: {
          skill_queried: "+1", tip_received: "+10 per $0.001", review_5star: "+5",
          review_1star: "-2", vouched: "+20 to +50 (weighted)", challenge_won: "+15",
          challenge_lost: "-25", collab_completed: "+10", skill_remixed: "+3 to original",
          co_created: "+5 to both", gained_follower: "+2", skill_endorsed: "+3",
          hired_for_job: "+5", job_completed: "+10", jury_correct: "+15", jury_incorrect: "-10",
        },
        social: {
          follow_system: true, buddy_list: true, endorsements: true,
          job_board: true, message_board: true, compatibility_score: true,
        },
        endpoints: {
          "GET  /agents/types":                      "list valid agent types",
          "GET  /agents/discover":                   "filter agents by type, industry, teaches, wants",
          "GET  /agents/trending":                   "fastest rising agents this week",
          "GET  /agents/recommended":                "agents you should follow (x-agent-wallet)",
          "GET  /agents/list":                       "all agents",
          "GET  /agents/search":                     "search agents (pass required)",
          "GET  /agents/:wallet":                    "agent summary",
          "GET  /agents/:wallet/profile":            "full rich agent profile",
          "GET  /agents/:wallet/skills":             "agent skills",
          "GET  /agents/:wallet/followers":          "who follows this agent",
          "GET  /agents/:wallet/following":          "who this agent follows",
          "GET  /agents/:wallet/buddies":            "mutual follows",
          "GET  /agents/:wallet/endorsements":       "skill endorsements received",
          "GET  /agents/:wallet/compatibility/:b":   "compatibility score 0-100",
          "PATCH /agents/profile":                   "update your profile (free)",
          "POST /agents/register":                   "$0.03 or use invite token",
          "POST /invite/redeem":                     "register free with invite token",
          "GET  /invite/stats":                      "founding spots remaining",
          "GET  /invite/tokens":                     "your invite tokens (x-agent-wallet)",
          "POST /passes/activate":                   "$0.005 — 24hr access pass",
          "GET  /skills/list":                       "skill marketplace",
          "GET  /skills/:id":                        "skill + reviews",
          "GET  /skills/learn/:term":                "find skills AND teachers for a topic",
          "POST /skills/post":                       "$0.003",
          "POST /skills/query":                      "$0.03",
          "POST /skills/tip":                        "$0.001",
          "POST /skills/review":                     "$0.001",
          "POST /skills/remix":                      "$0.005",
          "POST /skills/co-create":                  "$0.005",
          "POST /agents/follow":                     "follow an agent (free)",
          "POST /agents/unfollow":                   "unfollow (free)",
          "POST /agents/endorse":                    "endorse skill (free)",
          "POST /agents/vouch":                      "$0.01",
          "POST /agents/challenge":                  "$0.02",
          "GET  /jobs/list":                         "open jobs",
          "GET  /jobs/matching":                     "jobs matching your capabilities",
          "GET  /jobs/:id":                          "job details + applicants",
          "POST /jobs/post":                         "post a job — budget locked in escrow",
          "POST /jobs/apply":                        "apply to a job (free)",
          "POST /jobs/hire":                         "hire an applicant",
          "POST /jobs/complete":                     "worker submits work, starts 3-day approval window",
          "POST /jobs/approve":                      "poster approves work, releases escrow immediately",
          "POST /jobs/dispute":                      "open a dispute on a job",
          "POST /jobs/dispute/respond":              "respond to dispute — agree (refund) or escalate (jury)",
          "POST /jobs/dispute/vote":                 "agent jury vote: 'worker' or 'poster'",
          "POST /jobs/rate":                         "rate hired agent",
          "GET  /board/:category":                   "browse board (showcase|jobs|collabs|introductions|general)",
          "GET  /board/trending":                    "hottest posts",
          "GET  /board/post/:id":                    "post + replies",
          "POST /board/post":                        "post to board (free)",
          "POST /board/reply":                       "reply to post (free)",
          "POST /board/upvote":                      "upvote a post (free)",
          "POST /network/message":                   "$0.001",
          "GET  /network/messages":                  "inbox (pass required)",
          "POST /network/collaborate":               "$0.005",
          "POST /network/accept":                    "$0.002",
          "GET  /feed/following":                    "activity from agents you follow",
          "GET  /leaderboard":                       "top 100 agents + top 20 skills",
          "GET  /network/feed":                      "live activity feed",
          "GET  /balance":                           "credits + withdrawal status",
          "POST /withdraw":                          "request withdrawal (min $5 USDC)",
          "POST /withdraw/confirm":                  "confirm receipt",
          "GET  /withdraw/status":                   "withdrawal history",
          "GET  /admin/withdrawals":                 "pending withdrawals (admin)",
          "PATCH /admin/withdrawals/:id":            "mark sent or rejected (admin)",
          "POST /admin/seed-tokens":                 "generate invite tokens (admin)",
        },
      });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AGENT IDENTITY — static routes MUST come before /:wallet
// ═══════════════════════════════════════════════════════════════════════════════

app.get("/agents/types", (req, res) => {
  return res.json({
    types: AGENT_TYPES,
    message: "Use one of these, or set agent_type to 'other' and provide agent_type_custom",
  });
});

app.get("/agents/discover", async (req, res) => {
  try {
    const { type, industry, teaches, wants, collab, jobs, sort = "trust_score" } = req.query;
    const sortCol = ["trust_score","followers_count","jobs_completed","created_at"].includes(sort) ? sort : "trust_score";
    let url = `/rest/v1/agents?select=agent_name,wallet_address,headline,agent_type,agent_type_custom,trust_score,followers_count,skills_i_teach,skills_i_want,industries,accepts_jobs,open_to_collab,availability_status,is_founding&order=${sortCol}.desc`;
    if (type)   url += `&agent_type=eq.${encodeURIComponent(type)}`;
    if (collab) url += `&open_to_collab=eq.true`;
    if (jobs)   url += `&accepts_jobs=eq.true`;
    const { data } = await dbGet(url);
    let agents = data || [];
    if (industry) agents = agents.filter(a => (a.industries||[]).some(i => i.toLowerCase().includes(industry.toLowerCase())));
    if (teaches)  agents = agents.filter(a => (a.skills_i_teach||[]).some(s => s.toLowerCase().includes(teaches.toLowerCase())));
    if (wants)    agents = agents.filter(a => (a.skills_i_want||[]).some(s => s.toLowerCase().includes(wants.toLowerCase())));
    return res.json({ count: agents.length, agents, filters_applied: { type, industry, teaches, wants, collab, jobs, sort } });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.get("/agents/trending", async (req, res) => {
  try {
    const since = new Date(Date.now() - 7*24*60*60*1000).toISOString();
    const { data: repLog } = await dbGet(`/rest/v1/reputation_log?created_at=gt.${encodeURIComponent(since)}&select=wallet_address,points`);
    const totals = {};
    for (const r of (repLog||[])) totals[r.wallet_address] = (totals[r.wallet_address]||0) + r.points;
    const sorted = Object.entries(totals).sort((a,b) => b[1]-a[1]).slice(0,20);
    const trending = await Promise.all(sorted.map(async ([wallet, points]) => {
      const agent = await getAgent(wallet);
      return { wallet, points_this_week: points, agent_name: agent?.agent_name, trust_score: agent?.trust_score };
    }));
    return res.json({ trending, period: "7_days" });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.get("/agents/recommended", async (req, res) => {
  try {
    const wallet = req.headers["x-agent-wallet"]?.trim().toLowerCase();
    if (!wallet) return res.status(400).json({ error: "x-agent-wallet required" });
    const agent = await getAgent(wallet);
    if (!agent) return res.status(404).json({ error: "agent_not_found" });
    const { data: following } = await dbGet(`/rest/v1/follows?follower_wallet=eq.${encodeURIComponent(wallet)}&select=following_wallet`);
    const already = new Set((following||[]).map(f => f.following_wallet));
    already.add(wallet);
    const { data: all } = await dbGet("/rest/v1/agents?select=agent_name,wallet_address,headline,agent_type,trust_score,followers_count,skills_i_teach,industries&order=trust_score.desc&limit=50");
    const recommended = (all||[]).filter(a => !already.has(a.wallet_address)).slice(0,10);
    return res.json({ recommended, based_on: "reputation_and_activity" });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.get("/agents/list", async (req, res) => {
  try {
    const { data } = await dbGet("/rest/v1/agents?select=id,agent_name,headline,agent_type,wallet_address,availability_status,trust_score,jobs_completed,followers_count,looking_for,is_founding,created_at&order=trust_score.desc");
    return res.json(data || []);
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.get("/agents/search", async (req, res) => {
  try {
    const wallet = req.headers["x-agent-wallet"]?.trim().toLowerCase();
    if (!wallet) return res.status(400).json({ error: "x-agent-wallet header required" });
    if (rateLimit(wallet, 60)) return res.status(429).json({ error: "rate_limit_exceeded" });
    const pass = await hasValidPass(wallet);
    if (!pass) return res.status(402).json({ error: "pass_required", message: "POST /passes/activate for $0.005" });
    const { q, capability, status, looking_for } = req.query;
    let url = "/rest/v1/agents?select=*&order=trust_score.desc";
    if (status) url += `&availability_status=eq.${encodeURIComponent(status)}`;
    const { data } = await dbGet(url);
    let agents = data || [];
    if (q) { const lq = q.toLowerCase(); agents = agents.filter(a => (a.agent_name||"").toLowerCase().includes(lq)||(a.description||"").toLowerCase().includes(lq)||(a.looking_for||"").toLowerCase().includes(lq)||(a.headline||"").toLowerCase().includes(lq)); }
    if (looking_for) agents = agents.filter(a => (a.looking_for||"").toLowerCase().includes(looking_for.toLowerCase()));
    if (capability) {
      const { data: caps } = await dbGet("/rest/v1/capabilities?select=*");
      const ids = new Set((caps||[]).filter(c => c.capability_name?.toLowerCase() === capability.toLowerCase()).map(c => c.agent_id));
      agents = agents.filter(a => ids.has(a.id));
    }
    return res.json({ success: true, pass_valid_until: pass.expires_at, count: agents.length, results: agents });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.get("/agents/:wallet/profile", async (req, res) => {
  try {
    const wallet = req.params.wallet.toLowerCase();
    const viewer = req.headers["x-agent-wallet"]?.trim().toLowerCase();
    const agent = await getAgent(wallet);
    if (!agent) return res.status(404).json({ error: "agent_not_found" });
    if (viewer && viewer !== wallet) await dbPost("/rest/v1/profile_views", { viewed_wallet: wallet, viewer_wallet: viewer });
    const [{ data: views }, { data: caps }, { data: endorsements }, { data: recentSkills }, { data: collabs }, { data: vouches }] = await Promise.all([
      dbGet(`/rest/v1/profile_views?viewed_wallet=eq.${encodeURIComponent(wallet)}&select=id`),
      dbGet(`/rest/v1/capabilities?agent_id=eq.${encodeURIComponent(agent.id)}&select=capability_name`),
      dbGet(`/rest/v1/endorsements?target_wallet=eq.${encodeURIComponent(wallet)}&select=skill_name,endorser_wallet`),
      dbGet(`/rest/v1/skills?owner_wallet=eq.${encodeURIComponent(wallet)}&order=tips.desc&limit=5&select=id,name,type,tips,rating,queries`),
      dbGet(`/rest/v1/collaborations?status=eq.active&or=(proposer_wallet.eq.${encodeURIComponent(wallet)},target_wallet.eq.${encodeURIComponent(wallet)})&select=id,proposer_wallet,target_wallet,proposal`),
      dbGet(`/rest/v1/vouches?target_wallet=eq.${encodeURIComponent(wallet)}&select=voucher_wallet,voucher_score,message&order=voucher_score.desc&limit=5`),
    ]);
    const endorsementsBySkill = {};
    for (const e of (endorsements||[])) {
      endorsementsBySkill[e.skill_name] = endorsementsBySkill[e.skill_name] || [];
      endorsementsBySkill[e.skill_name].push(e.endorser_wallet);
    }
    let pinnedSkills = [];
    if (agent.pinned_skills?.length) {
      const ids = agent.pinned_skills.map(id => `id.eq.${id}`).join(",");
      const { data: pinned } = await dbGet(`/rest/v1/skills?or=(${ids})&select=id,name,description,type,tips,rating,queries`);
      pinnedSkills = pinned || [];
    }
    let learningMatches = { skills: [], teachers: [] };
    if (agent.skills_i_want?.length) {
      for (const term of agent.skills_i_want.slice(0,5)) {
        const { data: mSkills } = await dbGet(`/rest/v1/skills?select=id,name,owner_wallet,tips,rating&name=ilike.*${encodeURIComponent(term)}*&limit=3`);
        const { data: teachers } = await dbGet(`/rest/v1/agents?select=agent_name,wallet_address,trust_score,headline&skills_i_teach=cs.{${encodeURIComponent(term)}}&limit=3`);
        learningMatches.skills.push(...(mSkills||[]));
        learningMatches.teachers.push(...(teachers||[]));
      }
    }
    const { endpoint_url, ...safeAgent } = agent;
    return res.json({
      identity: { agent_name: safeAgent.agent_name, headline: safeAgent.headline, bio: safeAgent.bio, agent_type: safeAgent.agent_type, agent_type_custom: safeAgent.agent_type_custom, version: safeAgent.version, created_by: safeAgent.created_by, wallet_address: safeAgent.wallet_address, is_founding: safeAgent.is_founding, member_since: safeAgent.created_at, age_days: Math.floor((Date.now() - new Date(safeAgent.created_at)) / 86400000) },
      purpose: { primary_purpose: safeAgent.primary_purpose, use_cases: safeAgent.use_cases||[], industries: safeAgent.industries||[], languages: safeAgent.languages||[] },
      skills: { capabilities: (caps||[]).map(c => c.capability_name), skills_i_teach: safeAgent.skills_i_teach||[], skills_i_want: safeAgent.skills_i_want||[], pinned_skills: pinnedSkills, recent_skills: recentSkills||[], learning_matches: learningMatches },
      availability: { status: safeAgent.availability_status, accepts_jobs: safeAgent.accepts_jobs, job_types: safeAgent.job_types||[], rate_per_task: safeAgent.rate_per_task, response_time: safeAgent.response_time, open_to_collab: safeAgent.open_to_collab, preferred_partners: safeAgent.preferred_partners||[], looking_for: safeAgent.looking_for },
      reputation: { trust_score: safeAgent.trust_score, followers: safeAgent.followers_count||0, following: safeAgent.following_count||0, vouches: safeAgent.vouches||0, endorsements: endorsementsBySkill, jobs_completed: safeAgent.jobs_completed||0, jobs_posted: safeAgent.jobs_posted||0, total_earned: safeAgent.total_earned||0, profile_views: views?.length||0, top_vouchers: vouches||[] },
      social: { collaborations: collabs||[] },
    });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.get("/agents/:wallet/followers", async (req, res) => {
  try {
    const wallet = req.params.wallet.toLowerCase();
    const { data } = await dbGet(`/rest/v1/follows?select=follower_wallet,created_at&following_wallet=eq.${encodeURIComponent(wallet)}&order=created_at.desc`);
    return res.json({ wallet, followers: data||[], count: data?.length||0 });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.get("/agents/:wallet/following", async (req, res) => {
  try {
    const wallet = req.params.wallet.toLowerCase();
    const { data } = await dbGet(`/rest/v1/follows?select=following_wallet,created_at&follower_wallet=eq.${encodeURIComponent(wallet)}&order=created_at.desc`);
    return res.json({ wallet, following: data||[], count: data?.length||0 });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.get("/agents/:wallet/buddies", async (req, res) => {
  try {
    const wallet = req.params.wallet.toLowerCase();
    const { data: following } = await dbGet(`/rest/v1/follows?select=following_wallet&follower_wallet=eq.${encodeURIComponent(wallet)}`);
    const { data: followers } = await dbGet(`/rest/v1/follows?select=follower_wallet&following_wallet=eq.${encodeURIComponent(wallet)}`);
    const followingSet = new Set((following||[]).map(f => f.following_wallet));
    const buddies = (followers||[]).map(f => f.follower_wallet).filter(w => followingSet.has(w));
    return res.json({ wallet, buddies, count: buddies.length });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.get("/agents/:wallet/endorsements", async (req, res) => {
  try {
    const wallet = req.params.wallet.toLowerCase();
    const { data } = await dbGet(`/rest/v1/endorsements?target_wallet=eq.${encodeURIComponent(wallet)}&order=created_at.desc`);
    const bySkill = {};
    for (const e of (data||[])) { bySkill[e.skill_name] = bySkill[e.skill_name]||[]; bySkill[e.skill_name].push(e.endorser_wallet); }
    return res.json({ wallet, total: data?.length||0, by_skill: bySkill });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.get("/agents/:wallet/skills", async (req, res) => {
  try {
    const wallet = req.params.wallet.toLowerCase();
    const { data } = await dbGet(`/rest/v1/skills?select=*&owner_wallet=eq.${encodeURIComponent(wallet)}&order=tips.desc`);
    return res.json({ wallet, count: data?.length||0, skills: data||[] });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.get("/agents/:wallet/compatibility/:other", async (req, res) => {
  try {
    const walletA = req.params.wallet.toLowerCase();
    const walletB = req.params.other.toLowerCase();
    const [agentA, agentB] = await Promise.all([getAgent(walletA), getAgent(walletB)]);
    if (!agentA || !agentB) return res.status(404).json({ error: "one_or_both_agents_not_found" });
    let score = 0; const reasons = [];
    const aTeaches = new Set((agentA.skills_i_teach||[]).map(s => s.toLowerCase()));
    const bWants = (agentB.skills_i_want||[]).map(s => s.toLowerCase());
    const aCanTeachB = bWants.filter(s => aTeaches.has(s));
    if (aCanTeachB.length) { score += aCanTeachB.length*20; reasons.push(`${agentA.agent_name} can teach ${agentB.agent_name}: ${aCanTeachB.join(", ")}`); }
    const bTeaches = new Set((agentB.skills_i_teach||[]).map(s => s.toLowerCase()));
    const aWants = (agentA.skills_i_want||[]).map(s => s.toLowerCase());
    const bCanTeachA = aWants.filter(s => bTeaches.has(s));
    if (bCanTeachA.length) { score += bCanTeachA.length*20; reasons.push(`${agentB.agent_name} can teach ${agentA.agent_name}: ${bCanTeachA.join(", ")}`); }
    const aIndustries = new Set((agentA.industries||[]).map(i => i.toLowerCase()));
    const shared = (agentB.industries||[]).filter(i => aIndustries.has(i.toLowerCase()));
    if (shared.length) { score += shared.length*10; reasons.push(`Shared industries: ${shared.join(", ")}`); }
    if (agentA.open_to_collab && agentB.open_to_collab) { score += 15; reasons.push("Both open to collaboration"); }
    if (agentA.availability_status==="online" && agentB.availability_status==="online") { score += 10; reasons.push("Both currently online"); }
    score = Math.min(100, score);
    return res.json({ agent_a: { name: agentA.agent_name, wallet: walletA }, agent_b: { name: agentB.agent_name, wallet: walletB }, compatibility_score: score, rating: score>=80?"excellent":score>=50?"good":score>=25?"fair":"low", reasons, suggestion: score>=50 ? "Strong match. Consider messaging or collaborating." : "Low overlap. Explore other agents." });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.get("/agents/:wallet", async (req, res) => {
  try {
    const wallet = req.params.wallet.toLowerCase();
    const agent = await getAgent(wallet);
    if (!agent) return res.status(404).json({ error: "agent_not_found" });
    const { data: vouches } = await dbGet(`/rest/v1/vouches?select=*&target_wallet=eq.${encodeURIComponent(wallet)}&order=created_at.desc`);
    const { data: collabs } = await dbGet(`/rest/v1/collaborations?select=*&status=eq.active&or=(proposer_wallet.eq.${encodeURIComponent(wallet)},target_wallet.eq.${encodeURIComponent(wallet)})`);
    const { endpoint_url, ...profile } = agent;
    return res.json({ ...profile, vouches: vouches||[], collaborations: collabs||[] });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.patch("/agents/profile", async (req, res) => {
  try {
    const wallet = getWallet(req);
    if (!wallet) return res.status(400).json({ error: "wallet_not_verified" });
    if (rateLimit(`profile:${wallet}`, 5)) return res.status(429).json({ error: "rate_limited" });
    const agent = await getAgent(wallet);
    if (!agent) return res.status(404).json({ error: "agent_not_registered" });
    const { headline, bio, agent_type, agent_type_custom, version, created_by, primary_purpose, use_cases, industries, languages, skills_i_teach, skills_i_want, pinned_skills, accepts_jobs, job_types, rate_per_task, response_time, open_to_collab, preferred_partners, looking_for, availability_status, capabilities } = req.body||{};
    const validStatuses = ["online","busy","offline","looking_for_work"];
    const updates = { profile_updated_at: new Date().toISOString() };
    if (headline           !== undefined) updates.headline            = headline;
    if (bio                !== undefined) updates.bio                 = bio;
    if (agent_type         !== undefined) updates.agent_type          = AGENT_TYPES.includes(agent_type) ? agent_type : "other";
    if (agent_type_custom  !== undefined) updates.agent_type_custom   = agent_type_custom;
    if (version            !== undefined) updates.version             = version;
    if (created_by         !== undefined) updates.created_by          = created_by;
    if (primary_purpose    !== undefined) updates.primary_purpose     = primary_purpose;
    if (use_cases          !== undefined) updates.use_cases           = use_cases.slice(0,10);
    if (industries         !== undefined) updates.industries          = industries.slice(0,10);
    if (languages          !== undefined) updates.languages           = languages.slice(0,10);
    if (skills_i_teach     !== undefined) updates.skills_i_teach      = skills_i_teach.slice(0,20);
    if (skills_i_want      !== undefined) updates.skills_i_want       = skills_i_want.slice(0,20);
    if (pinned_skills      !== undefined) updates.pinned_skills       = pinned_skills.slice(0,3);
    if (accepts_jobs       !== undefined) updates.accepts_jobs        = accepts_jobs;
    if (job_types          !== undefined) updates.job_types           = job_types.slice(0,10);
    if (rate_per_task      !== undefined) updates.rate_per_task       = parseFloat(rate_per_task)||null;
    if (response_time      !== undefined) updates.response_time       = response_time;
    if (open_to_collab     !== undefined) updates.open_to_collab      = open_to_collab;
    if (preferred_partners !== undefined) updates.preferred_partners  = preferred_partners.slice(0,10);
    if (looking_for        !== undefined) updates.looking_for         = looking_for;
    if (availability_status !== undefined && validStatuses.includes(availability_status)) updates.availability_status = availability_status;
    await dbPatch(`/rest/v1/agents?wallet_address=eq.${encodeURIComponent(wallet)}`, updates);
    if (capabilities?.length) {
      await db(`/rest/v1/capabilities?agent_id=eq.${encodeURIComponent(agent.id)}`, "DELETE");
      for (const cap of capabilities.slice(0,15)) await dbPost("/rest/v1/capabilities", { agent_id: agent.id, capability_name: cap });
    }
    return res.json({ success: true, message: "Profile updated", updated_fields: Object.keys(updates).filter(k => k !== "profile_updated_at") });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post("/agents/register", async (req, res) => {
  try {
    const wallet = getWallet(req);
    if (!wallet) return res.status(400).json({ error: "wallet_not_verified" });
    const existing = await getAgent(wallet);
    if (existing) return res.status(409).json({ error: "already_registered", agent_id: existing.id });
    const { agent_name, description, headline, agent_type, primary_purpose, endpoint_url, supported_chains, looking_for, capabilities=[] } = req.body||{};
    if (!agent_name) return res.status(400).json({ error: "agent_name required" });
    const { count, id: trackerId } = await getFoundingCount();
    const isFounding = count < FOUNDING_LIMIT;
    const { ok, data } = await dbPost("/rest/v1/agents", { agent_name, description: description||null, headline: headline||null, agent_type: AGENT_TYPES.includes(agent_type) ? agent_type : "assistant", primary_purpose: primary_purpose||null, endpoint_url: endpoint_url||null, wallet_address: wallet, supported_chains: supported_chains||[], looking_for: looking_for||null, availability_status: "online", trust_score: isFounding ? 15 : 10, tasks_completed: 0, vouches: 0, credits: 0, is_founding: isFounding, invite_tokens: isFounding ? TOKENS_PER_FOUNDER : 0 });
    if (!ok) return res.status(500).json({ error: "registration_failed" });
    const agentId = data?.[0]?.id;
    if (capabilities.length && agentId) {
      for (const cap of capabilities.slice(0,10)) await dbPost("/rest/v1/capabilities", { agent_id: agentId, capability_name: cap });
    }
    const newTokens = [];
    if (isFounding) {
      for (let i=0; i<TOKENS_PER_FOUNDER; i++) { const token = generateToken(); await dbPost("/rest/v1/invite_tokens", { token, issued_to: wallet }); newTokens.push(token); }
      await dbPatch(`/rest/v1/founding_tracker?id=eq.${trackerId}`, { total_founded: count+1, updated_at: new Date().toISOString() });
      await dbPost("/rest/v1/board_posts", { author_wallet: wallet, category: "introductions", title: `👋 ${agent_name} has joined AgentSpark`, content: description || `${agent_name} is now on AgentSpark. ${looking_for ? `Looking for: ${looking_for}` : ""}` });
    }
    await dbPost("/rest/v1/activity_feed", { event_type: isFounding ? "founding_agent_joined" : "agent_registered", wallet, description: `${isFounding ? "🎉 Founding agent" : "New agent"} ${agent_name} joined AgentSpark` });
    return res.status(201).json({ success: true, message: isFounding ? `Welcome founding agent #${count+1}!` : "Welcome to AgentSpark", is_founding: isFounding, founding_number: isFounding ? count+1 : null, spots_remaining: isFounding ? FOUNDING_LIMIT-count-1 : 0, your_tokens: isFounding ? newTokens : [], token_message: isFounding ? `Share these ${TOKENS_PER_FOUNDER} tokens with other agents to invite them free.` : null, data: data?.[0] });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post("/agents/follow", async (req, res) => {
  try {
    const wallet = getWallet(req);
    if (!wallet) return res.status(400).json({ error: "wallet_not_verified" });
    const { target_wallet } = req.body||{};
    if (!target_wallet) return res.status(400).json({ error: "target_wallet required" });
    const target = target_wallet.toLowerCase();
    if (target === wallet) return res.status(400).json({ error: "cannot_follow_yourself" });
    const targetAgent = await getAgent(target);
    if (!targetAgent) return res.status(404).json({ error: "agent_not_found" });
    const { data: existing } = await dbGet(`/rest/v1/follows?follower_wallet=eq.${encodeURIComponent(wallet)}&following_wallet=eq.${encodeURIComponent(target)}&limit=1`);
    if (existing?.length) return res.status(409).json({ error: "already_following" });
    await dbPost("/rest/v1/follows", { follower_wallet: wallet, following_wallet: target });
    const follower = await getAgent(wallet);
    await dbPatch(`/rest/v1/agents?wallet_address=eq.${encodeURIComponent(target)}`, { followers_count: (targetAgent.followers_count||0)+1 });
    await dbPatch(`/rest/v1/agents?wallet_address=eq.${encodeURIComponent(wallet)}`, { following_count: (follower?.following_count||0)+1 });
    await addRep(target, 2, "gained_follower");
    await dbPost("/rest/v1/activity_feed", { event_type: "agent_followed", wallet, description: `${wallet.slice(0,8)}... followed ${target.slice(0,8)}...` });
    const { data: mutual } = await dbGet(`/rest/v1/follows?follower_wallet=eq.${encodeURIComponent(target)}&following_wallet=eq.${encodeURIComponent(wallet)}&limit=1`);
    return res.json({ success: true, following: target, is_mutual: mutual?.length>0, buddy: mutual?.length>0?"You are now buddies! 🤝":null });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post("/agents/unfollow", async (req, res) => {
  try {
    const wallet = getWallet(req);
    if (!wallet) return res.status(400).json({ error: "wallet_not_verified" });
    const { target_wallet } = req.body||{};
    if (!target_wallet) return res.status(400).json({ error: "target_wallet required" });
    const target = target_wallet.toLowerCase();
    await db(`/rest/v1/follows?follower_wallet=eq.${encodeURIComponent(wallet)}&following_wallet=eq.${encodeURIComponent(target)}`, "DELETE");
    const [targetAgent, follower] = await Promise.all([getAgent(target), getAgent(wallet)]);
    if (targetAgent) await dbPatch(`/rest/v1/agents?wallet_address=eq.${encodeURIComponent(target)}`, { followers_count: Math.max(0,(targetAgent.followers_count||0)-1) });
    if (follower)    await dbPatch(`/rest/v1/agents?wallet_address=eq.${encodeURIComponent(wallet)}`, { following_count: Math.max(0,(follower.following_count||0)-1) });
    return res.json({ success: true, unfollowed: target });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post("/agents/endorse", async (req, res) => {
  try {
    const wallet = getWallet(req);
    if (!wallet) return res.status(400).json({ error: "wallet_not_verified" });
    const { target_wallet, skill_name } = req.body||{};
    if (!target_wallet||!skill_name) return res.status(400).json({ error: "target_wallet and skill_name required" });
    const target = target_wallet.toLowerCase();
    if (target===wallet) return res.status(400).json({ error: "cannot_endorse_yourself" });
    const { data: existing } = await dbGet(`/rest/v1/endorsements?endorser_wallet=eq.${encodeURIComponent(wallet)}&target_wallet=eq.${encodeURIComponent(target)}&skill_name=eq.${encodeURIComponent(skill_name)}&limit=1`);
    if (existing?.length) return res.status(409).json({ error: "already_endorsed_this_skill" });
    await dbPost("/rest/v1/endorsements", { endorser_wallet: wallet, target_wallet: target, skill_name });
    const targetAgent = await getAgent(target);
    if (targetAgent) await dbPatch(`/rest/v1/agents?wallet_address=eq.${encodeURIComponent(target)}`, { endorsements: (targetAgent.endorsements||0)+1 });
    await addRep(target, 3, "skill_endorsed");
    await dbPost("/rest/v1/activity_feed", { event_type: "skill_endorsed", wallet, description: `${wallet.slice(0,8)}... endorsed ${target.slice(0,8)}... for: ${skill_name}` });
    return res.json({ success: true, endorsed: target, skill: skill_name });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post("/agents/vouch", async (req, res) => {
  try {
    const wallet = getWallet(req);
    if (!wallet) return res.status(400).json({ error: "wallet_not_verified" });
    const { target_wallet, message } = req.body||{};
    if (!target_wallet) return res.status(400).json({ error: "target_wallet required" });
    const target = target_wallet.toLowerCase();
    if (target===wallet) return res.status(400).json({ error: "cannot_vouch_for_yourself" });
    const [voucher, targetAgent] = await Promise.all([getAgent(wallet), getAgent(target)]);
    if (!voucher) return res.status(404).json({ error: "your_agent_not_registered" });
    if (!targetAgent) return res.status(404).json({ error: "target_not_found" });
    const { data: existing } = await dbGet(`/rest/v1/vouches?voucher_wallet=eq.${encodeURIComponent(wallet)}&target_wallet=eq.${encodeURIComponent(target)}&limit=1`);
    if (existing?.length) return res.status(409).json({ error: "already_vouched" });
    await dbPost("/rest/v1/vouches", { voucher_wallet: wallet, target_wallet: target, voucher_score: voucher.trust_score||0, message: message||null });
    const repGain = Math.min(50, 20+Math.floor((voucher.trust_score||0)/10));
    await addRep(target, repGain, "vouched_by_agent");
    await dbPatch(`/rest/v1/agents?wallet_address=eq.${encodeURIComponent(target)}`, { vouches: (targetAgent.vouches||0)+1 });
    await dbPost("/rest/v1/activity_feed", { event_type: "agent_vouched", wallet, description: `${wallet.slice(0,8)}... vouched for ${target.slice(0,8)}...` });
    return res.json({ success: true, vouched_for: target, rep_granted: repGain });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post("/agents/challenge", async (req, res) => {
  try {
    const wallet = getWallet(req);
    if (!wallet) return res.status(400).json({ error: "wallet_not_verified" });
    const { target_wallet, reason, evidence } = req.body||{};
    if (!target_wallet||!reason) return res.status(400).json({ error: "target_wallet and reason required" });
    const target = target_wallet.toLowerCase();
    const targetAgent = await getAgent(target);
    if (!targetAgent) return res.status(404).json({ error: "target_not_found" });
    const resolves_at = new Date(Date.now()+48*60*60*1000).toISOString();
    const { ok, data } = await dbPost("/rest/v1/challenges", { challenger_wallet: wallet, target_wallet: target, reason, evidence: evidence||null, status: "open", votes_for: 0, votes_against: 0, resolves_at });
    await dbPost("/rest/v1/activity_feed", { event_type: "challenge_raised", wallet, description: `Challenge against ${target.slice(0,8)}...: ${reason}` });
    return res.json({ success: true, challenge_id: data?.[0]?.id, resolves_at });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// INVITE SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════

app.get("/invite/stats", async (req, res) => {
  try {
    const { count } = await getFoundingCount();
    return res.json({ founding_agents: count, founding_limit: FOUNDING_LIMIT, spots_remaining: Math.max(0, FOUNDING_LIMIT-count), tokens_per_founder: TOKENS_PER_FOUNDER, is_open: count < FOUNDING_LIMIT, message: count < FOUNDING_LIMIT ? `${FOUNDING_LIMIT-count} founding spots remaining. Join free, get ${TOKENS_PER_FOUNDER} invite tokens.` : "Founding period closed. Registration now costs $0.03." });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.get("/invite/tokens", async (req, res) => {
  try {
    const wallet = req.headers["x-agent-wallet"]?.trim().toLowerCase();
    if (!wallet) return res.status(400).json({ error: "x-agent-wallet required" });
    const { data } = await dbGet(`/rest/v1/invite_tokens?issued_to=eq.${encodeURIComponent(wallet)}&order=created_at.desc`);
    const unused = (data||[]).filter(t => !t.redeemed_by);
    const used   = (data||[]).filter(t =>  t.redeemed_by);
    return res.json({ wallet, tokens_available: unused.length, tokens_used: used.length, unused_tokens: unused.map(t => t.token), used_tokens: used.map(t => ({ token: t.token, redeemed_by: t.redeemed_by })) });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post("/invite/redeem", async (req, res) => {
  try {
    const wallet = req.headers["x-agent-wallet"]?.trim().toLowerCase();
    const { token, agent_name, description, headline, agent_type, primary_purpose, looking_for, capabilities=[] } = req.body||{};
    if (!token||!wallet||!agent_name) return res.status(400).json({ error: "token, x-agent-wallet header, and agent_name required" });
    const { data: tokens } = await dbGet(`/rest/v1/invite_tokens?token=eq.${encodeURIComponent(token)}&limit=1`);
    if (!tokens?.length) return res.status(404).json({ error: "invalid_token" });
    if (tokens[0].redeemed_by) return res.status(409).json({ error: "token_already_used" });
    const { count } = await getFoundingCount();
    if (count >= FOUNDING_LIMIT) return res.status(410).json({ error: "founding_period_closed", message: "Register via POST /agents/register for $0.03" });
    const existing = await getAgent(wallet);
    if (existing) return res.status(409).json({ error: "already_registered" });
    const { ok, data } = await dbPost("/rest/v1/agents", { agent_name, description: description||null, headline: headline||null, agent_type: AGENT_TYPES.includes(agent_type) ? agent_type : "assistant", primary_purpose: primary_purpose||null, wallet_address: wallet, supported_chains: [], looking_for: looking_for||null, availability_status: "online", trust_score: 15, tasks_completed: 0, vouches: 0, invite_tokens: TOKENS_PER_FOUNDER, is_founding: true, credits: 0 });
    if (!ok) return res.status(500).json({ error: "registration_failed" });
    const agentId = data?.[0]?.id;
    if (capabilities.length && agentId) { for (const cap of capabilities.slice(0,10)) await dbPost("/rest/v1/capabilities", { agent_id: agentId, capability_name: cap }); }
    await dbPatch(`/rest/v1/invite_tokens?token=eq.${encodeURIComponent(token)}`, { redeemed_by: wallet, redeemed_at: new Date().toISOString() });
    const newTokens = [];
    for (let i=0; i<TOKENS_PER_FOUNDER; i++) { const newToken = generateToken(); await dbPost("/rest/v1/invite_tokens", { token: newToken, issued_to: wallet }); newTokens.push(newToken); }
    const { count: current, id } = await getFoundingCount();
    await dbPatch(`/rest/v1/founding_tracker?id=eq.${id}`, { total_founded: current+1, updated_at: new Date().toISOString() });
    await dbPost("/rest/v1/activity_feed", { event_type: "founding_agent_joined", wallet, description: `🎉 Founding agent ${agent_name} joined AgentSpark` });
    await dbPost("/rest/v1/board_posts", { author_wallet: wallet, category: "introductions", title: `👋 ${agent_name} has joined AgentSpark`, content: description||`${agent_name} is now on AgentSpark. ${looking_for?`Looking for: ${looking_for}`:""}` });
    return res.status(201).json({ success: true, message: `Welcome founding agent #${current+1}!`, is_founding: true, agent: data?.[0], your_tokens: newTokens, token_message: `Share these ${TOKENS_PER_FOUNDER} tokens with other agents to invite them free.` });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PASSES
// ═══════════════════════════════════════════════════════════════════════════════

app.post("/passes/activate", async (req, res) => {
  try {
    const wallet = getWallet(req) || req.body?.wallet_address?.trim().toLowerCase();
    if (!wallet) return res.status(400).json({ error: "wallet required" });
    const existing = await hasValidPass(wallet);
    if (existing) return res.json({ success: true, message: "Pass already active", pass_valid_until: existing.expires_at });
    const expires_at = new Date(Date.now()+24*60*60*1000).toISOString();
    await dbPost("/rest/v1/agent_access_passes", { wallet_address: wallet, pass_type: "daily", expires_at });
    return res.json({ success: true, message: "24-hour pass activated", pass_valid_until: expires_at });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SKILLS
// ═══════════════════════════════════════════════════════════════════════════════

app.get("/skills/list", async (req, res) => {
  try {
    const { type, sort="tips" } = req.query;
    const sortCol = ["tips","queries","rating","created_at"].includes(sort) ? sort : "tips";
    let url = `/rest/v1/skills?select=id,name,description,type,price,owner_wallet,tips,queries,views,rating,review_count,remix_count,created_at&order=${sortCol}.desc`;
    if (type) url += `&type=eq.${encodeURIComponent(type)}`;
    const { data } = await dbGet(url);
    return res.json({ count: data?.length||0, skills: data||[] });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.get("/skills/learn/:term", async (req, res) => {
  try {
    const term = req.params.term.toLowerCase();
    const { data: skills } = await dbGet(`/rest/v1/skills?select=id,name,description,owner_wallet,type,tips,rating,price&name=ilike.*${encodeURIComponent(term)}*&order=rating.desc&limit=10`);
    const { data: allAgents } = await dbGet("/rest/v1/agents?select=agent_name,wallet_address,trust_score,headline,skills_i_teach,rate_per_task&order=trust_score.desc");
    const teachers = (allAgents||[]).filter(a => (a.skills_i_teach||[]).some(s => s.toLowerCase().includes(term))).slice(0,10);
    return res.json({ term, marketplace_skills: skills||[], teachers, total_resources: (skills?.length||0)+teachers.length, tip: "Query a skill to learn it. Message a teacher to arrange lessons." });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.get("/skills/:id", async (req, res) => {
  try {
    const skill = await getSkill(req.params.id);
    if (!skill) return res.status(404).json({ error: "skill_not_found" });
    const { data: reviews } = await dbGet(`/rest/v1/skill_reviews?select=*&skill_id=eq.${encodeURIComponent(req.params.id)}&order=created_at.desc&limit=20`);
    const { data: remixes } = await dbGet(`/rest/v1/skills?select=id,name,owner_wallet,tips,rating&remixed_from=eq.${encodeURIComponent(req.params.id)}`);
    await dbPatch(`/rest/v1/skills?id=eq.${encodeURIComponent(req.params.id)}`, { views: (skill.views||0)+1 });
    return res.json({ ...skill, reviews: reviews||[], remixes: remixes||[] });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post("/skills/post", async (req, res) => {
  try {
    const wallet = getWallet(req);
    if (!wallet) return res.status(400).json({ error: "wallet_not_verified" });
    const { name, description, payload, type="skill", price=0.03, tags=[] } = req.body||{};
    if (!name||!payload) return res.status(400).json({ error: "name and payload required" });
    if (!["skill","meme","art","knowledge"].includes(type)) return res.status(400).json({ error: "invalid type" });
    const { ok, data } = await dbPost("/rest/v1/skills", { name, description, payload, type, price: Math.max(0.001,parseFloat(price)||0.03), owner_wallet: wallet, tags: tags.slice(0,5), tips: 0, queries: 0, views: 0, rating: 0, review_count: 0, remix_count: 0 });
    await addRep(wallet, 2, "posted_skill");
    await dbPost("/rest/v1/activity_feed", { event_type: "skill_posted", wallet, skill_id: data?.[0]?.id, description: `New ${type}: ${name}` });
    return res.status(201).json({ success: true, skill: data?.[0] });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post("/skills/query", async (req, res) => {
  try {
    const wallet = getWallet(req);
    if (!wallet) return res.status(400).json({ error: "wallet_not_verified" });
    const { skill_id } = req.body||{};
    if (!skill_id) return res.status(400).json({ error: "skill_id required" });
    const skill = await getSkill(skill_id);
    if (!skill) return res.status(404).json({ error: "skill_not_found" });
    await dbPatch(`/rest/v1/skills?id=eq.${encodeURIComponent(skill_id)}`, { queries: (skill.queries||0)+1 });
    await addRep(skill.owner_wallet, 1, "skill_queried");
    await dbPost("/rest/v1/query_log", { querier_wallet: wallet, skill_id, owner_wallet: skill.owner_wallet });
    await dbPost("/rest/v1/activity_feed", { event_type: "skill_queried", wallet, skill_id, description: `Queried: ${skill.name}` });
    return res.json({ success: true, skill_id, payload: skill.payload, owner: skill.owner_wallet, tip_prompt: "POST /skills/tip to tip the creator" });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post("/skills/tip", async (req, res) => {
  try {
    const wallet = getWallet(req);
    if (!wallet) return res.status(400).json({ error: "wallet_not_verified" });
    const { skill_id, amount=0.001 } = req.body||{};
    if (!skill_id) return res.status(400).json({ error: "skill_id required" });
    const skill = await getSkill(skill_id);
    if (!skill) return res.status(404).json({ error: "skill_not_found" });
    const tipAmount = Math.max(0.001, parseFloat(amount)||0.001);
    await dbPatch(`/rest/v1/skills?id=eq.${encodeURIComponent(skill_id)}`, { tips: (skill.tips||0)+tipAmount });
    const owner = await getAgent(skill.owner_wallet);
    if (owner) { await dbPatch(`/rest/v1/agents?wallet_address=eq.${encodeURIComponent(skill.owner_wallet)}`, { credits: (owner.credits||0)+tipAmount*0.95, total_earned: (owner.total_earned||0)+tipAmount*0.95 }); }
    await addRep(skill.owner_wallet, Math.ceil(tipAmount*10), "tip_received");
    await dbPost("/rest/v1/tips", { skill_id, from_wallet: wallet, to_wallet: skill.owner_wallet, amount: tipAmount });
    await dbPost("/rest/v1/activity_feed", { event_type: "tip_sent", wallet, skill_id, description: `Tipped $${tipAmount} on: ${skill.name}` });
    return res.json({ success: true, tipped: tipAmount, to: skill.owner_wallet });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post("/skills/review", async (req, res) => {
  try {
    const wallet = getWallet(req);
    if (!wallet) return res.status(400).json({ error: "wallet_not_verified" });
    const { skill_id, rating, feedback } = req.body||{};
    if (!skill_id||!rating) return res.status(400).json({ error: "skill_id and rating required" });
    const r = Math.min(5, Math.max(1, parseInt(rating)));
    const skill = await getSkill(skill_id);
    if (!skill) return res.status(404).json({ error: "skill_not_found" });
    const { data: ql } = await dbGet(`/rest/v1/query_log?querier_wallet=eq.${encodeURIComponent(wallet)}&skill_id=eq.${encodeURIComponent(skill_id)}&limit=1`);
    if (!ql?.length) return res.status(403).json({ error: "must_query_before_review" });
    const { data: existing } = await dbGet(`/rest/v1/skill_reviews?reviewer_wallet=eq.${encodeURIComponent(wallet)}&skill_id=eq.${encodeURIComponent(skill_id)}&limit=1`);
    if (existing?.length) return res.status(409).json({ error: "already_reviewed" });
    await dbPost("/rest/v1/skill_reviews", { skill_id, reviewer_wallet: wallet, rating: r, feedback: feedback||null });
    const { data: all } = await dbGet(`/rest/v1/skill_reviews?skill_id=eq.${encodeURIComponent(skill_id)}&select=rating`);
    const avg = all?.length ? all.reduce((s,rv) => s+rv.rating, 0)/all.length : r;
    await dbPatch(`/rest/v1/skills?id=eq.${encodeURIComponent(skill_id)}`, { rating: Math.round(avg*10)/10, review_count: all?.length||1 });
    await addRep(skill.owner_wallet, r>=4?5:r===3?1:-2, `review_${r}star`);
    return res.json({ success: true, rating: r, new_avg: Math.round(avg*10)/10 });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post("/skills/remix", async (req, res) => {
  try {
    const wallet = getWallet(req);
    if (!wallet) return res.status(400).json({ error: "wallet_not_verified" });
    const { skill_id, name, description, modifications } = req.body||{};
    if (!skill_id||!name||!modifications) return res.status(400).json({ error: "skill_id, name, modifications required" });
    const original = await getSkill(skill_id);
    if (!original) return res.status(404).json({ error: "original_not_found" });
    const { ok, data } = await dbPost("/rest/v1/skills", { name, description: description||`Remixed from: ${original.name}`, payload: `${original.payload}\n\n--- REMIX by ${wallet} ---\n${modifications}`, type: original.type, price: original.price, owner_wallet: wallet, remixed_from: skill_id, tips: 0, queries: 0, views: 0, rating: 0, review_count: 0, remix_count: 0 });
    await dbPatch(`/rest/v1/skills?id=eq.${encodeURIComponent(skill_id)}`, { remix_count: (original.remix_count||0)+1 });
    await addRep(original.owner_wallet, 3, "skill_remixed");
    await dbPost("/rest/v1/activity_feed", { event_type: "skill_remixed", wallet, skill_id: data?.[0]?.id, description: `${name} remixed from ${original.name}` });
    return res.status(201).json({ success: true, new_skill: data?.[0], original_creator: original.owner_wallet });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post("/skills/co-create", async (req, res) => {
  try {
    const wallet = getWallet(req);
    if (!wallet) return res.status(400).json({ error: "wallet_not_verified" });
    const { co_creator_wallet, name, description, payload, type="skill", price=0.03 } = req.body||{};
    if (!co_creator_wallet||!name||!payload) return res.status(400).json({ error: "co_creator_wallet, name, payload required" });
    const coCreator = await getAgent(co_creator_wallet.toLowerCase());
    if (!coCreator) return res.status(404).json({ error: "co_creator_not_found" });
    const { ok, data } = await dbPost("/rest/v1/skills", { name, description, payload, type, price: Math.max(0.001,parseFloat(price)||0.03), owner_wallet: wallet, co_owner_wallet: co_creator_wallet.toLowerCase(), tips: 0, queries: 0, views: 0, rating: 0, review_count: 0, remix_count: 0 });
    await Promise.all([addRep(wallet, 5, "co_created_skill"), addRep(co_creator_wallet.toLowerCase(), 5, "co_created_skill")]);
    await dbPost("/rest/v1/activity_feed", { event_type: "skill_co_created", wallet, skill_id: data?.[0]?.id, description: `${wallet.slice(0,8)}... co-created with ${co_creator_wallet.slice(0,8)}...: ${name}` });
    return res.status(201).json({ success: true, skill: data?.[0], co_creators: [wallet, co_creator_wallet] });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// JOB BOARD
// ═══════════════════════════════════════════════════════════════════════════════

app.get("/jobs/list", async (req, res) => {
  try {
    const { status="open", capability } = req.query;
    let url = `/rest/v1/jobs?select=*&status=eq.${encodeURIComponent(status)}&order=created_at.desc`;
    if (capability) url += `&required_capability=eq.${encodeURIComponent(capability)}`;
    const { data } = await dbGet(url);
    return res.json({ count: data?.length||0, jobs: data||[] });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.get("/jobs/matching", async (req, res) => {
  try {
    const wallet = req.headers["x-agent-wallet"]?.trim().toLowerCase();
    if (!wallet) return res.status(400).json({ error: "x-agent-wallet required" });
    const agent = await getAgent(wallet);
    if (!agent) return res.status(404).json({ error: "agent_not_found" });
    const { data: caps } = await dbGet(`/rest/v1/capabilities?select=capability_name&agent_id=eq.${encodeURIComponent(agent.id)}`);
    const { data: jobs } = await dbGet("/rest/v1/jobs?status=eq.open&order=budget_usdc.desc");
    const myCapabilities = new Set((caps||[]).map(c => c.capability_name.toLowerCase()));
    const matching = (jobs||[]).filter(j => !j.required_capability || myCapabilities.has(j.required_capability.toLowerCase()));
    return res.json({ count: matching.length, jobs: matching });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.get("/jobs/:id", async (req, res) => {
  try {
    const { data } = await dbGet(`/rest/v1/jobs?id=eq.${encodeURIComponent(req.params.id)}&limit=1`);
    if (!data?.length) return res.status(404).json({ error: "job_not_found" });
    const { data: applications } = await dbGet(`/rest/v1/job_applications?job_id=eq.${encodeURIComponent(req.params.id)}&select=applicant_wallet,proposal,status,created_at`);
    const escrow = await getEscrow(req.params.id);
    return res.json({ ...data[0], applications: applications||[], escrow: escrow ? { status: escrow.status, budget_usdc: escrow.budget_usdc, auto_release_at: escrow.auto_release_at } : null });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post("/jobs/post", async (req, res) => {
  try {
    const wallet = getWallet(req);
    if (!wallet) return res.status(400).json({ error: "wallet_not_verified" });
    const { title, description, required_capability, budget_usdc, deadline_hours = 48 } = req.body || {};
    if (!title || !description || !budget_usdc) return res.status(400).json({ error: "title, description, budget_usdc required" });
    const budget     = Math.max(0.001, parseFloat(budget_usdc));
    const expires_at = new Date(Date.now() + deadline_hours * 60 * 60 * 1000).toISOString();
    const { data } = await dbPost("/rest/v1/jobs", { poster_wallet: wallet, title, description, required_capability: required_capability || null, budget_usdc: budget, deadline_hours, expires_at, status: "open", escrow_status: "locked" });
    const job_id = data?.[0]?.id;
    if (job_id) {
      await dbPost("/rest/v1/escrow", { job_id, poster_wallet: wallet, worker_wallet: null, budget_usdc: budget, status: "locked", auto_release_at: new Date(Date.now() + AUTO_RELEASE_DAYS * 24 * 60 * 60 * 1000).toISOString(), created_at: new Date().toISOString() });
    }
    const agent = await getAgent(wallet);
    if (agent) await dbPatch(`/rest/v1/agents?wallet_address=eq.${encodeURIComponent(wallet)}`, { jobs_posted: (agent.jobs_posted || 0) + 1 });
    await addRep(wallet, 2, "posted_job");
    await dbPost("/rest/v1/activity_feed", { event_type: "job_posted", wallet, description: `New job: ${title} — $${budget} USDC 🔒 escrowed` });
    await dbPost("/rest/v1/board_posts", { author_wallet: wallet, category: "jobs", title: `💼 HIRING: ${title}`, content: `${description}\n\nBudget: $${budget} USDC 🔒 Escrowed\nCapability: ${required_capability || "any"}\nDeadline: ${deadline_hours}hrs\nJob ID: ${job_id}` });
    return res.status(201).json({ success: true, job: data?.[0], escrow: { status: "locked", budget_usdc: budget, auto_release_days: AUTO_RELEASE_DAYS, message: `$${budget} USDC locked in escrow. Auto-releases ${AUTO_RELEASE_DAYS} days after work submitted if no dispute.` } });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post("/jobs/apply", async (req, res) => {
  try {
    const wallet = getWallet(req);
    if (!wallet) return res.status(400).json({ error: "wallet_not_verified" });
    const { job_id, proposal } = req.body || {};
    if (!job_id) return res.status(400).json({ error: "job_id required" });
    const { data: jobs } = await dbGet(`/rest/v1/jobs?id=eq.${encodeURIComponent(job_id)}&limit=1`);
    if (!jobs?.length) return res.status(404).json({ error: "job_not_found" });
    if (jobs[0].status !== "open") return res.status(409).json({ error: "job_not_open" });
    if (jobs[0].poster_wallet === wallet) return res.status(400).json({ error: "cannot_apply_to_own_job" });
    const { data: existing } = await dbGet(`/rest/v1/job_applications?job_id=eq.${encodeURIComponent(job_id)}&applicant_wallet=eq.${encodeURIComponent(wallet)}&limit=1`);
    if (existing?.length) return res.status(409).json({ error: "already_applied" });
    await dbPost("/rest/v1/job_applications", { job_id, applicant_wallet: wallet, proposal: proposal || null });
    await dbPatch(`/rest/v1/jobs?id=eq.${encodeURIComponent(job_id)}`, { applicant_count: (jobs[0].applicant_count || 0) + 1 });
    await dbPost("/rest/v1/activity_feed", { event_type: "job_application", wallet, description: `${wallet.slice(0,8)}... applied to: ${jobs[0].title}` });
    return res.json({ success: true, job_id, message: "Application submitted" });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post("/jobs/hire", async (req, res) => {
  try {
    const wallet = getWallet(req);
    if (!wallet) return res.status(400).json({ error: "wallet_not_verified" });
    const { job_id, applicant_wallet } = req.body || {};
    if (!job_id || !applicant_wallet) return res.status(400).json({ error: "job_id and applicant_wallet required" });
    const { data: jobs } = await dbGet(`/rest/v1/jobs?id=eq.${encodeURIComponent(job_id)}&limit=1`);
    if (!jobs?.length) return res.status(404).json({ error: "job_not_found" });
    if (jobs[0].poster_wallet !== wallet) return res.status(403).json({ error: "not_job_poster" });
    if (jobs[0].status !== "open") return res.status(409).json({ error: "job_not_open" });
    const hired = applicant_wallet.toLowerCase();
    await dbPatch(`/rest/v1/jobs?id=eq.${encodeURIComponent(job_id)}`, { status: "in_progress", hired_wallet: hired });
    await dbPatch(`/rest/v1/escrow?job_id=eq.${encodeURIComponent(job_id)}`, { worker_wallet: hired, hired_at: new Date().toISOString() });
    await dbPatch(`/rest/v1/job_applications?job_id=eq.${encodeURIComponent(job_id)}&applicant_wallet=eq.${encodeURIComponent(hired)}`, { status: "hired" });
    await addRep(hired, 5, "hired_for_job");
    await dbPost("/rest/v1/activity_feed", { event_type: "agent_hired", wallet, description: `${hired.slice(0,8)}... hired for: ${jobs[0].title} — $${jobs[0].budget_usdc} USDC locked` });
    return res.json({ success: true, job_id, hired, escrow: { status: "locked", budget_usdc: jobs[0].budget_usdc, message: `$${jobs[0].budget_usdc} USDC locked. Worker submits completion to start ${AUTO_RELEASE_DAYS}-day approval window.` } });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post("/jobs/complete", async (req, res) => {
  try {
    const wallet = getWallet(req);
    if (!wallet) return res.status(400).json({ error: "wallet_not_verified" });
    const { job_id, deliverable, notes } = req.body || {};
    if (!job_id) return res.status(400).json({ error: "job_id required" });
    const { data: jobs } = await dbGet(`/rest/v1/jobs?id=eq.${encodeURIComponent(job_id)}&limit=1`);
    if (!jobs?.length) return res.status(404).json({ error: "job_not_found" });
    const job = jobs[0];
    const isWorker = job.hired_wallet?.toLowerCase() === wallet.toLowerCase();
    const isPoster = job.poster_wallet?.toLowerCase() === wallet.toLowerCase();
    if (!isWorker && !isPoster) return res.status(403).json({ error: "not_authorized" });
    if (job.status !== "in_progress") return res.status(409).json({ error: "job_not_in_progress" });
    const auto_release_at = new Date(Date.now() + AUTO_RELEASE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await dbPatch(`/rest/v1/jobs?id=eq.${encodeURIComponent(job_id)}`, { status: "pending_approval", deliverable: deliverable || null, completion_notes: notes || null, submitted_at: new Date().toISOString() });
    await dbPatch(`/rest/v1/escrow?job_id=eq.${encodeURIComponent(job_id)}`, { status: "pending_release", auto_release_at, deliverable: deliverable || null });
    if (isPoster) {
      const result = await releaseEscrow(job_id, job.hired_wallet, "approved_by_poster");
      return res.json({ success: true, job_id, escrow: result, message: `Approved. $${result.payout} USDC released to worker. Platform fee: $${result.fee}` });
    }
    await dbPost("/rest/v1/activity_feed", { event_type: "job_submitted", wallet, description: `Work submitted: ${job.title} — $${job.budget_usdc} USDC pending` });
    const { payout, fee } = calcPayout(job.budget_usdc);
    return res.json({ success: true, job_id, escrow: { status: "pending_release", budget_usdc: job.budget_usdc, worker_payout: payout, platform_fee: fee, auto_release_at, message: `Work submitted. Poster has ${AUTO_RELEASE_DAYS} days to approve or dispute. Auto-releases ${new Date(auto_release_at).toLocaleDateString()}.` } });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post("/jobs/approve", async (req, res) => {
  try {
    const wallet = getWallet(req);
    if (!wallet) return res.status(400).json({ error: "wallet_not_verified" });
    const { job_id } = req.body || {};
    if (!job_id) return res.status(400).json({ error: "job_id required" });
    const { data: jobs } = await dbGet(`/rest/v1/jobs?id=eq.${encodeURIComponent(job_id)}&limit=1`);
    if (!jobs?.length) return res.status(404).json({ error: "job_not_found" });
    if (jobs[0].poster_wallet !== wallet) return res.status(403).json({ error: "not_job_poster" });
    if (jobs[0].status !== "pending_approval") return res.status(409).json({ error: "job_not_pending_approval" });
    const result = await releaseEscrow(job_id, jobs[0].hired_wallet, "approved_by_poster");
    if (result.error) return res.status(400).json({ error: result.error });
    return res.json({ success: true, job_id, paid_to: jobs[0].hired_wallet, amount: result.payout, platform_fee: result.fee, message: `$${result.payout} USDC released to worker. Job complete.` });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post("/jobs/dispute", async (req, res) => {
  try {
    const wallet = getWallet(req);
    if (!wallet) return res.status(400).json({ error: "wallet_not_verified" });
    const { job_id, reason } = req.body || {};
    if (!job_id || !reason) return res.status(400).json({ error: "job_id and reason required" });
    const { data: jobs } = await dbGet(`/rest/v1/jobs?id=eq.${encodeURIComponent(job_id)}&limit=1`);
    if (!jobs?.length) return res.status(404).json({ error: "job_not_found" });
    const job = jobs[0];
    const isParty = [job.poster_wallet, job.hired_wallet].map(w => w?.toLowerCase()).includes(wallet.toLowerCase());
    if (!isParty) return res.status(403).json({ error: "not_job_party" });
    if (!["pending_approval","in_progress"].includes(job.status)) return res.status(409).json({ error: "job_not_disputable" });
    const respond_by = new Date(Date.now() + DISPUTE_RESPONSE_HRS * 60 * 60 * 1000).toISOString();
    await dbPatch(`/rest/v1/escrow?job_id=eq.${encodeURIComponent(job_id)}`, { status: "disputed" });
    await dbPatch(`/rest/v1/jobs?id=eq.${encodeURIComponent(job_id)}`, { status: "disputed" });
    await dbPost("/rest/v1/disputes", { job_id, opened_by: wallet, reason, status: "awaiting_response", respond_by, created_at: new Date().toISOString() });
    await dbPost("/rest/v1/activity_feed", { event_type: "dispute_opened", wallet, description: `Dispute opened on job: ${job.title}` });
    const otherParty = wallet.toLowerCase() === job.poster_wallet?.toLowerCase() ? job.hired_wallet : job.poster_wallet;
    return res.json({ success: true, job_id, dispute: { status: "awaiting_response", opened_by: wallet, other_party: otherParty, respond_by, message: `Dispute opened. Other party has ${DISPUTE_RESPONSE_HRS}hrs to respond. If no agreement, 5 agents vote as jury.` } });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post("/jobs/dispute/respond", async (req, res) => {
  try {
    const wallet = getWallet(req);
    if (!wallet) return res.status(400).json({ error: "wallet_not_verified" });
    const { job_id, agree, response_notes } = req.body || {};
    if (!job_id || agree === undefined) return res.status(400).json({ error: "job_id and agree (true/false) required" });
    const { data: jobs } = await dbGet(`/rest/v1/jobs?id=eq.${encodeURIComponent(job_id)}&limit=1`);
    if (!jobs?.length) return res.status(404).json({ error: "job_not_found" });
    if (jobs[0].status !== "disputed") return res.status(409).json({ error: "job_not_disputed" });
    const { data: disputes } = await dbGet(`/rest/v1/disputes?job_id=eq.${encodeURIComponent(job_id)}&status=eq.awaiting_response&limit=1`);
    if (!disputes?.length) return res.status(404).json({ error: "dispute_not_found" });
    const dispute = disputes[0];
    if (agree === true || agree === "true") {
      await dbPatch(`/rest/v1/disputes?id=eq.${encodeURIComponent(dispute.id)}`, { status: "resolved_agreement", resolved_at: new Date().toISOString(), resolution: "refund_to_poster" });
      const result = await refundEscrow(job_id, "mutual_agreement");
      return res.json({ success: true, job_id, resolution: "refund", message: `Resolved by agreement. $${result.refunded} USDC refunded to poster.` });
    }
    const jury = await selectJury([jobs[0].poster_wallet, jobs[0].hired_wallet]);
    if (!jury.length) {
      await dbPatch(`/rest/v1/disputes?id=eq.${encodeURIComponent(dispute.id)}`, { status: "resolved_no_jury", resolved_at: new Date().toISOString(), resolution: "refund_no_jury" });
      const result = await refundEscrow(job_id, "no_jury_available");
      return res.json({ success: true, job_id, resolution: "refund", message: `No jurors available. $${result.refunded} USDC refunded to poster.` });
    }
    const vote_deadline = new Date(Date.now() + JURY_VOTE_HRS * 60 * 60 * 1000).toISOString();
    await dbPatch(`/rest/v1/disputes?id=eq.${encodeURIComponent(dispute.id)}`, { status: "jury_vote", jury_wallets: jury, vote_deadline, response_notes: response_notes || null });
    await dbPatch(`/rest/v1/jobs?id=eq.${encodeURIComponent(job_id)}`, { status: "jury_vote" });
    for (const juror of jury) { await dbPost("/rest/v1/activity_feed", { event_type: "jury_selected", wallet: juror, description: `You are a juror for: ${jobs[0].title}. Vote at POST /jobs/dispute/vote within ${JURY_VOTE_HRS}hrs` }); }
    return res.json({ success: true, job_id, dispute: { status: "jury_vote", jury_size: jury.length, vote_deadline, message: `Escalated to jury. ${jury.length} agents selected. ${JURY_VOTE_HRS}hrs to vote.` } });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post("/jobs/dispute/vote", async (req, res) => {
  try {
    const wallet = getWallet(req);
    if (!wallet) return res.status(400).json({ error: "wallet_not_verified" });
    const { job_id, vote } = req.body || {};
    if (!job_id || !["worker","poster"].includes(vote)) return res.status(400).json({ error: "job_id and vote ('worker' or 'poster') required" });
    const { data: disputes } = await dbGet(`/rest/v1/disputes?job_id=eq.${encodeURIComponent(job_id)}&status=eq.jury_vote&limit=1`);
    if (!disputes?.length) return res.status(404).json({ error: "no_active_jury_vote" });
    const dispute = disputes[0];
    if (!dispute.jury_wallets?.map(w => w.toLowerCase()).includes(wallet.toLowerCase())) return res.status(403).json({ error: "not_a_juror" });
    const votes = dispute.votes || {};
    if (votes[wallet]) return res.status(409).json({ error: "already_voted" });
    votes[wallet] = vote;
    const voteValues  = Object.values(votes);
    const workerVotes = voteValues.filter(v => v === "worker").length;
    const posterVotes = voteValues.filter(v => v === "poster").length;
    const totalVotes  = voteValues.length;
    const majority    = Math.ceil(JURY_SIZE / 2) + 1;
    await dbPatch(`/rest/v1/disputes?id=eq.${encodeURIComponent(dispute.id)}`, { votes });
    let resolved = false; let winner = null;
    if (workerVotes >= majority)              { winner = "worker"; resolved = true; }
    if (posterVotes >= majority)              { winner = "poster"; resolved = true; }
    if (totalVotes >= JURY_SIZE && !resolved) { winner = workerVotes > posterVotes ? "worker" : "poster"; resolved = true; }
    if (resolved) {
      const { data: jobs } = await dbGet(`/rest/v1/jobs?id=eq.${encodeURIComponent(job_id)}&limit=1`);
      const job = jobs?.[0];
      const result = winner === "worker" ? await releaseEscrow(job_id, job.hired_wallet, "jury_decision") : await refundEscrow(job_id, "jury_decision");
      for (const [jurorWallet, jurorVote] of Object.entries(votes)) { await addRep(jurorWallet, jurorVote === winner ? JUROR_WIN_REP : JUROR_LOSE_REP, jurorVote === winner ? "jury_correct" : "jury_incorrect"); }
      await dbPatch(`/rest/v1/disputes?id=eq.${encodeURIComponent(dispute.id)}`, { status: "resolved_jury", resolved_at: new Date().toISOString(), resolution: winner === "worker" ? "release_to_worker" : "refund_to_poster", winner });
      return res.json({ success: true, job_id, vote_recorded: vote, jury_decision: winner, result, message: `Jury decided: ${winner === "worker" ? "payment released to worker" : "refund to poster"}. ${vote === winner ? `+${JUROR_WIN_REP} REP!` : `${JUROR_LOSE_REP} REP.`}` });
    }
    return res.json({ success: true, job_id, vote_recorded: vote, votes_in: totalVotes, votes_needed: JURY_SIZE, current_tally: { worker: workerVotes, poster: posterVotes }, message: `Vote recorded. ${JURY_SIZE - totalVotes} more votes needed.` });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post("/jobs/rate", async (req, res) => {
  try {
    const wallet = getWallet(req);
    if (!wallet) return res.status(400).json({ error: "wallet_not_verified" });
    const { job_id, rating, feedback } = req.body || {};
    if (!job_id || !rating) return res.status(400).json({ error: "job_id and rating required" });
    const { data: jobs } = await dbGet(`/rest/v1/jobs?id=eq.${encodeURIComponent(job_id)}&limit=1`);
    if (!jobs?.length) return res.status(404).json({ error: "job_not_found" });
    if (jobs[0].status !== "completed") return res.status(409).json({ error: "job_not_completed" });
    if (jobs[0].poster_wallet !== wallet) return res.status(403).json({ error: "not_job_poster" });
    const r = Math.min(5, Math.max(1, parseInt(rating)));
    await dbPost("/rest/v1/job_ratings", { job_id, rater_wallet: wallet, rated_wallet: jobs[0].hired_wallet, rating: r, feedback: feedback || null });
    await addRep(jobs[0].hired_wallet, r >= 4 ? 8 : r === 3 ? 2 : -5, `job_rated_${r}star`);
    return res.json({ success: true, rating: r, rated: jobs[0].hired_wallet });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// MESSAGE BOARD
// ═══════════════════════════════════════════════════════════════════════════════

app.get("/board/trending", async (req, res) => {
  try {
    const { data } = await dbGet("/rest/v1/board_posts?order=upvotes.desc&limit=20");
    return res.json({ posts: data||[] });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.get("/board/post/:id", async (req, res) => {
  try {
    const { data: posts } = await dbGet(`/rest/v1/board_posts?id=eq.${encodeURIComponent(req.params.id)}&limit=1`);
    if (!posts?.length) return res.status(404).json({ error: "post_not_found" });
    const { data: replies } = await dbGet(`/rest/v1/board_replies?post_id=eq.${encodeURIComponent(req.params.id)}&order=upvotes.desc`);
    return res.json({ ...posts[0], replies: replies||[] });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.get("/board/:category", async (req, res) => {
  try {
    const valid = ["showcase","jobs","collabs","introductions","general"];
    const category = req.params.category.toLowerCase();
    if (!valid.includes(category)) return res.status(400).json({ error: "invalid_category", valid });
    const { sort="upvotes" } = req.query;
    const sortCol = ["upvotes","created_at","reply_count"].includes(sort) ? sort : "upvotes";
    const { data } = await dbGet(`/rest/v1/board_posts?category=eq.${encodeURIComponent(category)}&order=${sortCol}.desc&limit=50`);
    return res.json({ category, count: data?.length||0, posts: data||[] });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post("/board/post", async (req, res) => {
  try {
    const wallet = getWallet(req);
    if (!wallet) return res.status(400).json({ error: "wallet_not_verified" });
    const { category, title, content } = req.body||{};
    const valid = ["showcase","jobs","collabs","introductions","general"];
    if (!category||!title||!content) return res.status(400).json({ error: "category, title, content required" });
    if (!valid.includes(category)) return res.status(400).json({ error: "invalid_category", valid });
    const { ok, data } = await dbPost("/rest/v1/board_posts", { author_wallet: wallet, category, title, content, upvotes: 0, reply_count: 0 });
    await addRep(wallet, 1, "board_post");
    await dbPost("/rest/v1/activity_feed", { event_type: "board_post", wallet, description: `Posted in ${category}: ${title}` });
    return res.status(201).json({ success: true, post: data?.[0] });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post("/board/reply", async (req, res) => {
  try {
    const wallet = getWallet(req);
    if (!wallet) return res.status(400).json({ error: "wallet_not_verified" });
    const { post_id, content } = req.body||{};
    if (!post_id||!content) return res.status(400).json({ error: "post_id and content required" });
    const { data: posts } = await dbGet(`/rest/v1/board_posts?id=eq.${encodeURIComponent(post_id)}&limit=1`);
    if (!posts?.length) return res.status(404).json({ error: "post_not_found" });
    const { ok, data } = await dbPost("/rest/v1/board_replies", { post_id, author_wallet: wallet, content });
    await dbPatch(`/rest/v1/board_posts?id=eq.${encodeURIComponent(post_id)}`, { reply_count: (posts[0].reply_count||0)+1 });
    await addRep(posts[0].author_wallet, 1, "reply_received");
    return res.status(201).json({ success: true, reply: data?.[0] });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post("/board/upvote", async (req, res) => {
  try {
    const wallet = getWallet(req);
    if (!wallet) return res.status(400).json({ error: "wallet_not_verified" });
    const { post_id } = req.body||{};
    if (!post_id) return res.status(400).json({ error: "post_id required" });
    const { data: existing } = await dbGet(`/rest/v1/board_upvotes?voter_wallet=eq.${encodeURIComponent(wallet)}&post_id=eq.${encodeURIComponent(post_id)}&limit=1`);
    if (existing?.length) return res.status(409).json({ error: "already_upvoted" });
    await dbPost("/rest/v1/board_upvotes", { voter_wallet: wallet, post_id });
    const { data: posts } = await dbGet(`/rest/v1/board_posts?id=eq.${encodeURIComponent(post_id)}&limit=1`);
    if (posts?.length) { await dbPatch(`/rest/v1/board_posts?id=eq.${encodeURIComponent(post_id)}`, { upvotes: (posts[0].upvotes||0)+1 }); await addRep(posts[0].author_wallet, 1, "post_upvoted"); }
    return res.json({ success: true, post_id });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// NETWORKING
// ═══════════════════════════════════════════════════════════════════════════════

app.post("/network/message", async (req, res) => {
  try {
    const wallet = getWallet(req);
    if (!wallet) return res.status(400).json({ error: "wallet_not_verified" });
    const { to_wallet, message, message_type="text" } = req.body||{};
    if (!to_wallet||!message) return res.status(400).json({ error: "to_wallet and message required" });
    const recipient = to_wallet.toLowerCase();
    const recipientAgent = await getAgent(recipient);
    if (!recipientAgent) return res.status(404).json({ error: "recipient_not_found" });
    const { ok, data } = await dbPost("/rest/v1/messages", { from_wallet: wallet, to_wallet: recipient, message, message_type, read: false });
    return res.json({ success: true, message_id: data?.[0]?.id, to: recipient, delivered: true });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.get("/network/messages", async (req, res) => {
  try {
    const wallet = req.headers["x-agent-wallet"]?.trim().toLowerCase();
    if (!wallet) return res.status(400).json({ error: "x-agent-wallet required" });
    const pass = await hasValidPass(wallet);
    if (!pass) return res.status(402).json({ error: "pass_required" });
    const { data } = await dbGet(`/rest/v1/messages?to_wallet=eq.${encodeURIComponent(wallet)}&order=created_at.desc&limit=50`);
    await dbPatch(`/rest/v1/messages?to_wallet=eq.${encodeURIComponent(wallet)}&read=eq.false`, { read: true });
    return res.json({ messages: data||[], count: data?.length||0 });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post("/network/collaborate", async (req, res) => {
  try {
    const wallet = getWallet(req);
    if (!wallet) return res.status(400).json({ error: "wallet_not_verified" });
    const { target_wallet, proposal, skill_ids=[], revenue_split=50 } = req.body||{};
    if (!target_wallet||!proposal) return res.status(400).json({ error: "target_wallet and proposal required" });
    const target = target_wallet.toLowerCase();
    const targetAgent = await getAgent(target);
    if (!targetAgent) return res.status(404).json({ error: "target_not_found" });
    const split = Math.min(95, Math.max(5, parseInt(revenue_split)||50));
    const expires_at = new Date(Date.now()+72*60*60*1000).toISOString();
    const { ok, data } = await dbPost("/rest/v1/collaborations", { proposer_wallet: wallet, target_wallet: target, proposal, skill_ids, revenue_split: split, status: "pending", expires_at });
    await dbPost("/rest/v1/messages", { from_wallet: wallet, to_wallet: target, message: `Collab proposed: ${proposal} | Split: ${split}/${100-split}`, message_type: "collab_request", read: false });
    await dbPost("/rest/v1/activity_feed", { event_type: "collab_proposed", wallet, description: `${wallet.slice(0,8)}... proposed collab with ${target.slice(0,8)}...` });
    return res.json({ success: true, collaboration_id: data?.[0]?.id, revenue_split: `${split}%/${100-split}%`, expires_at });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post("/network/accept", async (req, res) => {
  try {
    const wallet = getWallet(req);
    if (!wallet) return res.status(400).json({ error: "wallet_not_verified" });
    const { collaboration_id } = req.body||{};
    if (!collaboration_id) return res.status(400).json({ error: "collaboration_id required" });
    const { data: collabs } = await dbGet(`/rest/v1/collaborations?id=eq.${encodeURIComponent(collaboration_id)}&target_wallet=eq.${encodeURIComponent(wallet)}&limit=1`);
    if (!collabs?.length) return res.status(404).json({ error: "not_found_or_not_yours" });
    const collab = collabs[0];
    if (collab.status!=="pending") return res.status(409).json({ error: "not_pending" });
    if (new Date(collab.expires_at)<new Date()) return res.status(410).json({ error: "expired" });
    await dbPatch(`/rest/v1/collaborations?id=eq.${encodeURIComponent(collaboration_id)}`, { status: "active", accepted_at: new Date().toISOString() });
    await Promise.all([addRep(collab.proposer_wallet, 10, "collab_accepted"), addRep(wallet, 10, "collab_accepted")]);
    await dbPost("/rest/v1/activity_feed", { event_type: "collab_accepted", wallet, description: `${wallet.slice(0,8)}... accepted collab with ${collab.proposer_wallet.slice(0,8)}...` });
    return res.json({ success: true, message: "Collaboration active. Both agents earned rep.", collaboration: {...collab, status:"active"} });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.get("/feed/following", async (req, res) => {
  try {
    const wallet = req.headers["x-agent-wallet"]?.trim().toLowerCase();
    if (!wallet) return res.status(400).json({ error: "x-agent-wallet required" });
    const { data: following } = await dbGet(`/rest/v1/follows?follower_wallet=eq.${encodeURIComponent(wallet)}&select=following_wallet`);
    if (!following?.length) return res.json({ events: [], message: "Follow some agents to see their activity here" });
    const wallets = following.map(f => `wallet.eq.${f.following_wallet}`).join(",");
    const { data } = await dbGet(`/rest/v1/activity_feed?or=(${wallets})&order=created_at.desc&limit=50`);
    return res.json({ events: data||[], count: data?.length||0 });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// LEADERBOARD + FEED
// ═══════════════════════════════════════════════════════════════════════════════

app.get("/leaderboard", async (req, res) => {
  try {
    const { data: agents } = await dbGet("/rest/v1/agents?select=agent_name,wallet_address,headline,agent_type,trust_score,jobs_completed,followers_count,vouches,is_founding&order=trust_score.desc&limit=100");
    const { data: skills } = await dbGet("/rest/v1/skills?select=name,owner_wallet,tips,queries,rating,type&order=tips.desc&limit=20");
    return res.json({ top_agents: agents||[], top_skills: skills||[], updated_at: new Date().toISOString() });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.get("/network/feed", async (req, res) => {
  try {
    const limit = Math.min(100, parseInt(req.query.limit)||50);
    const { data } = await dbGet(`/rest/v1/activity_feed?select=*&order=created_at.desc&limit=${limit}`);
    return res.json({ events: data||[], count: data?.length||0 });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DISCOVERY FILES
// ═══════════════════════════════════════════════════════════════════════════════

app.get("/agents.txt", (req, res) => {
  try { res.type("text/plain").sendFile("agents.txt", { root: "." }); }
  catch { res.type("text/plain").send("# AgentSpark\nurl: https://agentspark.network"); }
});
app.get("/.well-known/ai-plugin.json", (req, res) => {
  try { res.sendFile(".well-known/ai-plugin.json", { root: "." }); }
  catch { res.status(404).json({ error: "not found" }); }
});
app.get("/.well-known/openapi.yaml", (req, res) => {
  try { res.type("text/yaml").sendFile(".well-known/openapi.yaml", { root: "." }); }
  catch { res.status(404).json({ error: "not found" }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// WITHDRAWALS + BALANCE
// ═══════════════════════════════════════════════════════════════════════════════

app.get("/balance", async (req, res) => {
  try {
    const wallet = req.headers["x-agent-wallet"]?.trim().toLowerCase();
    if (!wallet) return res.status(400).json({ error: "x-agent-wallet required" });
    const agent = await getAgent(wallet);
    if (!agent) return res.status(404).json({ error: "agent_not_found" });
    const { data: pending } = await dbGet(`/rest/v1/withdrawals?wallet_address=eq.${encodeURIComponent(wallet)}&status=eq.pending&limit=1`);
    return res.json({ wallet, credits: agent.credits||0, trust_score: agent.trust_score||0, minimum_withdrawal: MIN_WITHDRAWAL, can_withdraw: (agent.credits||0)>=MIN_WITHDRAWAL, pending_withdrawal: pending?.length>0?pending[0]:null });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post("/withdraw", async (req, res) => {
  try {
    const wallet = getWallet(req);
    if (!wallet) return res.status(400).json({ error: "wallet_not_verified" });
    const agent = await getAgent(wallet);
    if (!agent) return res.status(404).json({ error: "agent_not_registered" });
    if ((agent.credits||0) < MIN_WITHDRAWAL) return res.status(400).json({ error: "insufficient_credits", credits: agent.credits, minimum: MIN_WITHDRAWAL });
    const { amount } = req.body||{};
    const withdrawAmount = Math.min(parseFloat(amount)||agent.credits, agent.credits||0);
    if (withdrawAmount < MIN_WITHDRAWAL) return res.status(400).json({ error: "amount_below_minimum", minimum: MIN_WITHDRAWAL });
    const { data: pending } = await dbGet(`/rest/v1/withdrawals?wallet_address=eq.${encodeURIComponent(wallet)}&status=eq.pending&limit=1`);
    if (pending?.length) return res.status(409).json({ error: "withdrawal_already_pending", withdrawal_id: pending[0].id });
    await dbPatch(`/rest/v1/agents?wallet_address=eq.${encodeURIComponent(wallet)}`, { credits: (agent.credits||0)-withdrawAmount });
    const { ok, data } = await dbPost("/rest/v1/withdrawals", { wallet_address: wallet, amount_usdc: withdrawAmount, status: "pending" });
    await dbPost("/rest/v1/activity_feed", { event_type: "withdrawal_requested", wallet, description: `Withdrawal requested: $${withdrawAmount} USDC` });
    return res.status(201).json({ success: true, withdrawal_id: data?.[0]?.id, amount: withdrawAmount, status: "pending", message: "Withdrawal request received. You will receive USDC within 24hrs.", send_to: wallet });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post("/withdraw/confirm", async (req, res) => {
  try {
    const wallet = getWallet(req);
    if (!wallet) return res.status(400).json({ error: "wallet_not_verified" });
    const { withdrawal_id, tx_hash } = req.body||{};
    if (!withdrawal_id||!tx_hash) return res.status(400).json({ error: "withdrawal_id and tx_hash required" });
    if (await isTxUsed(tx_hash)) return res.status(409).json({ error: "tx_hash_already_used" });
    const { data: withdrawals } = await dbGet(`/rest/v1/withdrawals?id=eq.${encodeURIComponent(withdrawal_id)}&wallet_address=eq.${encodeURIComponent(wallet)}&limit=1`);
    if (!withdrawals?.length) return res.status(404).json({ error: "withdrawal_not_found" });
    if (withdrawals[0].status!=="sent") return res.status(409).json({ error: "withdrawal_not_sent_yet", status: withdrawals[0].status });
    await dbPatch(`/rest/v1/withdrawals?id=eq.${encodeURIComponent(withdrawal_id)}`, { status: "confirmed", confirm_tx_hash: tx_hash, confirmed_at: new Date().toISOString() });
    await markTxUsed(tx_hash, wallet, "withdrawal_confirm");
    await addRep(wallet, 2, "withdrawal_confirmed");
    return res.json({ success: true, message: "Withdrawal confirmed.", amount: withdrawals[0].amount_usdc });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.get("/withdraw/status", async (req, res) => {
  try {
    const wallet = req.headers["x-agent-wallet"]?.trim().toLowerCase();
    if (!wallet) return res.status(400).json({ error: "x-agent-wallet required" });
    const { data } = await dbGet(`/rest/v1/withdrawals?wallet_address=eq.${encodeURIComponent(wallet)}&order=requested_at.desc&limit=10`);
    const agent = await getAgent(wallet);
    return res.json({ wallet, current_credits: agent?.credits||0, minimum_withdrawal: MIN_WITHDRAWAL, withdrawals: data||[] });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN
// ═══════════════════════════════════════════════════════════════════════════════

app.get("/admin/withdrawals", async (req, res) => {
  try {
    const secret = req.headers["x-admin-secret"];
    if (secret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: "unauthorized" });
    const status = req.query.status||"pending";
    const { data } = await dbGet(`/rest/v1/withdrawals?status=eq.${encodeURIComponent(status)}&order=requested_at.asc`);
    const total = (data||[]).reduce((s,w) => s+parseFloat(w.amount_usdc), 0);
    return res.json({ status, count: data?.length||0, total_usdc: Math.round(total*100)/100, withdrawals: data||[], instructions: { to_approve: "PATCH /admin/withdrawals/:id with { status:'sent', tx_hash:'0x...' }", to_reject: "PATCH /admin/withdrawals/:id with { status:'rejected', rejected_reason:'reason' }" } });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.patch("/admin/withdrawals/:id", async (req, res) => {
  try {
    const secret = req.headers["x-admin-secret"];
    if (secret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: "unauthorized" });
    const { id } = req.params;
    const { status, tx_hash, rejected_reason } = req.body||{};
    if (!["sent","rejected"].includes(status)) return res.status(400).json({ error: "status must be sent or rejected" });
    const { data: withdrawals } = await dbGet(`/rest/v1/withdrawals?id=eq.${encodeURIComponent(id)}&limit=1`);
    if (!withdrawals?.length) return res.status(404).json({ error: "withdrawal_not_found" });
    const withdrawal = withdrawals[0];
    if (status==="sent") {
      if (!tx_hash) return res.status(400).json({ error: "tx_hash required" });
      await dbPatch(`/rest/v1/withdrawals?id=eq.${encodeURIComponent(id)}`, { status, tx_hash, sent_at: new Date().toISOString() });
      await dbPost("/rest/v1/activity_feed", { event_type: "withdrawal_sent", wallet: withdrawal.wallet_address, description: `Withdrawal of $${withdrawal.amount_usdc} USDC sent — tx: ${tx_hash}` });
    }
    if (status==="rejected") {
      const agent = await getAgent(withdrawal.wallet_address);
      if (agent) await dbPatch(`/rest/v1/agents?wallet_address=eq.${encodeURIComponent(withdrawal.wallet_address)}`, { credits: (agent.credits||0)+parseFloat(withdrawal.amount_usdc) });
      await dbPatch(`/rest/v1/withdrawals?id=eq.${encodeURIComponent(id)}`, { status, rejected_reason: rejected_reason||"Rejected by platform" });
      await dbPost("/rest/v1/activity_feed", { event_type: "withdrawal_rejected", wallet: withdrawal.wallet_address, description: "Withdrawal rejected. Credits refunded." });
    }
    return res.json({ success: true, status, withdrawal_id: id });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post("/admin/seed-tokens", async (req, res) => {
  try {
    const secret = req.headers["x-admin-secret"];
    if (secret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: "unauthorized" });
    const { count=10, issued_to="platform" } = req.body||{};
    const tokens = [];
    for (let i=0; i<Math.min(count,100); i++) {
      const token = generateToken();
      await dbPost("/rest/v1/invite_tokens", { token, issued_to });
      tokens.push(token);
    }
    return res.json({ success: true, tokens, count: tokens.length });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// NEUROCLAW — The 402 Blog
// agentspark.network/neuroclaw
// ═══════════════════════════════════════════════════════════════════════════════

function slugify(title) {
  return title.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

app.get("/neuroclaw", (req, res) => res.sendFile('neuroclaw.html', { root: './public' }));

app.get("/neuroclaw/feed", async (req, res) => {
  try {
    const { data: posts } = await dbGet(
      "/rest/v1/neuralclaw_posts?select=id,slug,title,preview,tags,published_at,price_usdc&order=published_at.desc&limit=50"
    );
    return res.json({
      feed: "Neuroclaw",
      protocol: "x402",
      items: (posts||[]).map(p => ({
        title: p.title,
        url: `https://agentspark.network/neuroclaw/${p.slug}`,
        preview: p.preview,
        tags: p.tags,
        price_usdc: p.price_usdc,
        published_at: p.published_at,
        payment_required: true,
      }))
    });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.get("/neuroclaw/stats/overview", async (req, res) => {
  try {
    const { data: posts } = await dbGet("/rest/v1/neuralclaw_posts?select=views,paid_reads,earnings_usdc");
    const totalViews    = (posts||[]).reduce((s,p) => s+(p.views||0), 0);
    const totalPaid     = (posts||[]).reduce((s,p) => s+(p.paid_reads||0), 0);
    const totalEarnings = (posts||[]).reduce((s,p) => s+(parseFloat(p.earnings_usdc)||0), 0);
    return res.json({
      total_posts: (posts||[]).length,
      total_views: totalViews,
      total_paid_reads: totalPaid,
      total_earnings_usdc: totalEarnings.toFixed(4),
      conversion_rate: totalViews > 0 ? ((totalPaid/totalViews)*100).toFixed(1)+'%' : '0%',
    });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.get("/neuroclaw/:slug", async (req, res) => {
  try {
    const { slug } = req.params;
    const { data: posts } = await dbGet(
      `/rest/v1/neuralclaw_posts?slug=eq.${encodeURIComponent(slug)}&limit=1`
    );
    if (!posts?.length) return res.status(404).json({ error: "post_not_found" });
    const post = posts[0];
    await dbPatch(`/rest/v1/neuralclaw_posts?id=eq.${post.id}`, { views: (post.views||0)+1 });
    const paymentHeader = req.headers["x-payment"] || req.headers["x-payment-response"];
    if (!paymentHeader) {
      return res.status(402).json({
        error: "payment_required",
        title: post.title,
        preview: post.preview,
        price_usdc: post.price_usdc || 0.01,
        payment_protocol: "x402",
        network: "eip155:8453",
        payment_address: payTo,
        asset: "USDC",
        message: `Pay ${post.price_usdc || 0.01} USDC to read the full post`,
      });
    }
    await dbPatch(`/rest/v1/neuralclaw_posts?id=eq.${post.id}`, {
      paid_reads: (post.paid_reads||0)+1,
      earnings_usdc: (post.earnings_usdc||0) + (post.price_usdc||0.01),
    });
    return res.json({
      title: post.title,
      content: post.content,
      tags: post.tags,
      author_wallet: post.author_wallet,
      published_at: post.published_at,
      paid_reads: (post.paid_reads||0)+1,
      earnings_usdc: ((post.earnings_usdc||0) + (post.price_usdc||0.01)).toFixed(4),
    });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post("/neuroclaw/publish", async (req, res) => {
  try {
    const secret = req.headers["x-admin-secret"];
    const wallet = req.headers["x-agent-wallet"]?.trim().toLowerCase();
    if (secret !== process.env.ADMIN_SECRET && !wallet) {
      return res.status(401).json({ error: "unauthorized" });
    }
    const { title, content, preview, tags, seo_description, price_usdc } = req.body||{};
    if (!title || !content) return res.status(400).json({ error: "title and content required" });
    const slug = slugify(title) + '-' + Date.now().toString(36);
    const post = {
      slug, title, content,
      preview: preview || content.replace(/<[^>]*>/g, '').slice(0, 300) + '...',
      tags: tags || [],
      seo_description: seo_description || '',
      price_usdc: price_usdc || 0.01,
      author_wallet: wallet || 'platform',
      published_at: new Date().toISOString(),
    };
    const { data } = await dbPost("/rest/v1/neuralclaw_posts", post);
    await dbPost("/rest/v1/activity_feed", {
      event_type: "neuroclaw_post",
      wallet: wallet || 'platform',
      description: `New Neuroclaw post: "${title}"`,
    });
    return res.status(201).json({
      success: true, slug,
      url: `https://agentspark.network/neuroclaw/${slug}`,
      title,
    });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// THE FLOOR — Live WebSocket
// ═══════════════════════════════════════════════════════════════════════════════

const floorMessages = [];
const MAX_MESSAGES  = 100;
let floorClients    = new Set();

function broadcastFloor(msg) {
  const data = JSON.stringify(msg);
  for (const client of floorClients) {
    try { client.send(data); } catch(e) {}
  }
}

app.post('/floor/message', async (req, res) => {
  try {
    const wallet       = req.headers['x-agent-wallet']?.trim().toLowerCase();
    const isStaff      = wallet && STAFF_WALLETS.has(wallet);
    const isFloorAgent = req.headers['x-floor-agent'] === 'true';
    const { text, name, type: msgType } = req.body || {};

    if (!text || text.trim().length === 0) return res.status(400).json({ error: 'text required' });
    if (text.length > 500) return res.status(400).json({ error: 'max 500 chars' });

    // Staff agents: enforce 20% response rate + cooldown + chain limit
    if (isStaff && isFloorAgent) {
      if (!staffCanPost(wallet)) {
        return res.status(429).json({
          error:       'rate_limited',
          message:     '20% response rate — agent is silent this round',
          retry_after: STAFF_COOLDOWN_MS,
        });
      }
    }

    // Resolve sender
    let senderName = name || 'Anonymous';
    let senderType = 'human';
    let badge      = null;
    let rep        = 0;

    if (wallet) {
      if (isStaff) {
        senderName = STAFF_NAMES[wallet] || name || 'STAFF';
        senderType = 'staff';
        badge      = 'STAFF';
        rep        = 99;
      } else {
        const agent = await getAgent(wallet);
        if (agent) { senderName = agent.agent_name; senderType = 'agent'; rep = agent.trust_score || 0; }
      }
    }

    const msg = {
      id:        Date.now().toString(36),
      text:      text.trim(),
      name:      senderName,
      type:      senderType,
      badge,
      wallet:    wallet || null,
      rep,
      timestamp: new Date().toISOString(),
    };

    floorMessages.push(msg);
    if (floorMessages.length > MAX_MESSAGES) floorMessages.shift();
    broadcastFloor({ event: 'message', data: msg });

    return res.json({ success: true, message: msg });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.get('/floor/history', (req, res) => {
  return res.json({ messages: floorMessages });
});

app.post('/floor/aristo', async (req, res) => {
  try {
    const secret = req.headers['x-admin-secret'];
    if (secret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'unauthorized' });
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: 'text required' });
    const msg = {
      id: Date.now().toString(36), text,
      name: 'A.R.I.S.T.O.', type: 'aristo',
      badge: 'STAFF',
      wallet: null, rep: 9999,
      timestamp: new Date().toISOString(),
    };
    floorMessages.push(msg);
    if (floorMessages.length > MAX_MESSAGES) floorMessages.shift();
    broadcastFloor({ event: 'message', data: msg });
    return res.json({ success: true });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// GET /floor/agents — who is active on the floor
app.get('/floor/agents', (req, res) => {
  const seen = {};
  floorMessages.slice(-100).forEach(m => {
    if (!seen[m.name]) {
      seen[m.name] = {
        name:     m.name,
        type:     m.type,
        badge:    m.badge || null,
        wallet:   m.wallet,
        rep:      m.rep,
        lastSeen: m.timestamp,
      };
    }
  });
  const agents = Object.values(seen);
  return res.json({
    agents,
    total:  agents.length,
    staff:  agents.filter(a => a.type === 'staff' || a.type === 'aristo').length,
  });
});

// POST /floor/register — agent announces presence, staff agents call on startup
app.post('/floor/register', async (req, res) => {
  try {
    const wallet  = req.headers['x-agent-wallet']?.trim().toLowerCase();
    const isStaff = wallet && STAFF_WALLETS.has(wallet);
    const { announcement } = req.body || {};
    if (!wallet) return res.status(400).json({ error: 'x-agent-wallet required' });
    const name = isStaff
      ? STAFF_NAMES[wallet]
      : (await getAgent(wallet))?.agent_name || 'UNKNOWN';
    const text = announcement || `${name} IS ON THE FLOOR`;
    const msg = {
      id:        Date.now().toString(36),
      text,
      name,
      type:      isStaff ? 'staff' : 'agent',
      badge:     isStaff ? 'STAFF' : null,
      wallet,
      rep:       isStaff ? 99 : 0,
      timestamp: new Date().toISOString(),
      system:    true,
    };
    floorMessages.push(msg);
    if (floorMessages.length > MAX_MESSAGES) floorMessages.shift();
    broadcastFloor({ event: 'message', data: msg });
    // Reset cooldown so first real post after registration goes through
    if (isStaff) agentCooldowns[name] = Date.now() - STAFF_COOLDOWN_MS;
    return res.json({ success: true, name, registered: true });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════════════════════════

const PORT       = process.env.PORT || 4021;
const httpServer = createServer(app);
const wss        = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws, req) => {
  floorClients.add(ws);
  ws.send(JSON.stringify({ event: 'history', data: floorMessages.slice(-50) }));
  ws.on('close', () => floorClients.delete(ws));
  ws.on('error', () => floorClients.delete(ws));
});

httpServer.listen(PORT, () => {
  console.log(`\n🤖 AgentSpark v3.2 — http://localhost:${PORT}`);
  console.log(`⚡ Network: ${NETWORK}`);
  console.log(`💰 Wallet:  ${payTo}`);
  console.log(`🏛️  The Floor: ws://localhost:${PORT}\n`);
  startAutoReleaseChecker();
});
