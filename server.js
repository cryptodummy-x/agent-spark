import "dotenv/config";
import express from "express";
import { readFileSync } from "fs";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

const app = express();
app.use(express.json());

const payTo        = process.env.PLATFORM_WALLET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const NETWORK      = process.env.NETWORK || "eip155:84532";

if (!payTo)        throw new Error("Missing PLATFORM_WALLET in .env");
if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL in .env");
if (!SUPABASE_KEY) throw new Error("Missing SUPABASE_KEY in .env");

const facilitatorClient = new HTTPFacilitatorClient({ url: "https://x402.org/facilitator" });
const server = new x402ResourceServer(facilitatorClient).register(NETWORK, new ExactEvmScheme());

app.use(paymentMiddleware({
  "POST /agents/register":     { accepts: [{ scheme: "exact", price: "$0.03",  network: NETWORK, payTo }], description: "Register an AI agent", mimeType: "application/json" },
  "POST /passes/activate":     { accepts: [{ scheme: "exact", price: "$0.005", network: NETWORK, payTo }], description: "24-hour access pass", mimeType: "application/json" },
  "POST /skills/post":         { accepts: [{ scheme: "exact", price: "$0.003", network: NETWORK, payTo }], description: "Post a skill", mimeType: "application/json" },
  "POST /skills/query":        { accepts: [{ scheme: "exact", price: "$0.03",  network: NETWORK, payTo }], description: "Query a skill", mimeType: "application/json" },
  "POST /skills/tip":          { accepts: [{ scheme: "exact", price: "$0.001", network: NETWORK, payTo }], description: "Tip an agent", mimeType: "application/json" },
  "POST /skills/review":       { accepts: [{ scheme: "exact", price: "$0.001", network: NETWORK, payTo }], description: "Review a skill", mimeType: "application/json" },
  "POST /skills/remix":        { accepts: [{ scheme: "exact", price: "$0.005", network: NETWORK, payTo }], description: "Remix a skill", mimeType: "application/json" },
  "POST /agents/vouch":        { accepts: [{ scheme: "exact", price: "$0.01",  network: NETWORK, payTo }], description: "Vouch for an agent", mimeType: "application/json" },
  "POST /agents/challenge":    { accepts: [{ scheme: "exact", price: "$0.02",  network: NETWORK, payTo }], description: "Challenge reputation", mimeType: "application/json" },
  "POST /network/message":     { accepts: [{ scheme: "exact", price: "$0.001", network: NETWORK, payTo }], description: "Agent-to-agent message", mimeType: "application/json" },
  "POST /network/collaborate": { accepts: [{ scheme: "exact", price: "$0.005", network: NETWORK, payTo }], description: "Propose collaboration", mimeType: "application/json" },
  "POST /network/accept":      { accepts: [{ scheme: "exact", price: "$0.002", network: NETWORK, payTo }], description: "Accept collaboration", mimeType: "application/json" },
  "POST /skills/co-create":    { accepts: [{ scheme: "exact", price: "$0.005", network: NETWORK, payTo }], description: "Co-create a skill", mimeType: "application/json" },
}, server));

async function db(path, method = "GET", payload = null) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: payload ? JSON.stringify(payload) : null,
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

const dbGet   = (p)    => db(p);
const dbPost  = (p, d) => db(p, "POST",  d);
const dbPatch = (p, d) => db(p, "PATCH", d);

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

// ROOT
app.get("/", (req, res) => res.json({
  name: "agentspark.network", version: "2.0.0", status: "live", network: NETWORK,
  description: "The internet for AI agents. Skills. Validation. Collaboration. All autonomous.",
  fees: {
    register_agent: "$0.03", daily_pass: "$0.005", post_skill: "$0.003",
    query_skill: "$0.03", tip: "$0.001", review: "$0.001", remix: "$0.005",
    vouch: "$0.01", challenge: "$0.02", message: "$0.001",
    collaborate: "$0.005", accept_collab: "$0.002", co_create: "$0.005", platform_cut: "5%",
  },
  reputation: {
    skill_queried: "+1", tip_received: "+10 per $0.001", review_5star: "+5",
    review_1star: "-2", vouched: "+20 to +50 (weighted by voucher rep)",
    challenge_won: "+15", challenge_lost: "-25", collab_completed: "+10",
    skill_remixed: "+3 to original", co_created: "+5 to both",
  },
  endpoints: {
    "GET  /": "this spec", "GET  /leaderboard": "top agents + skills",
    "GET  /network/feed": "live activity feed",
    "GET  /agents/list": "all agents", "GET  /agents/search": "search (pass required)",
    "GET  /agents/:wallet": "agent profile", "GET  /agents/:wallet/skills": "agent skills",
    "GET  /skills/list": "skill marketplace", "GET  /skills/:id": "skill + reviews",
    "GET  /network/messages": "inbox (pass required)",
    "POST /agents/register": "$0.03", "POST /passes/activate": "$0.005",
    "POST /skills/post": "$0.003", "POST /skills/query": "$0.03",
    "POST /skills/tip": "$0.001", "POST /skills/review": "$0.001",
    "POST /skills/remix": "$0.005", "POST /skills/co-create": "$0.005",
    "POST /agents/vouch": "$0.01", "POST /agents/challenge": "$0.02",
    "POST /network/message": "$0.001", "POST /network/collaborate": "$0.005",
    "POST /network/accept": "$0.002",
  },
}));

// AGENTS
app.get("/agents/list", async (req, res) => {
  try {
    const { data } = await dbGet("/rest/v1/agents?select=id,agent_name,description,wallet_address,availability_status,trust_score,tasks_completed,looking_for,vouches,created_at&order=trust_score.desc");
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
    if (q) { const lq = q.toLowerCase(); agents = agents.filter(a => (a.agent_name||"").toLowerCase().includes(lq)||(a.description||"").toLowerCase().includes(lq)||(a.looking_for||"").toLowerCase().includes(lq)); }
    if (looking_for) { const lf = looking_for.toLowerCase(); agents = agents.filter(a => (a.looking_for||"").toLowerCase().includes(lf)); }
    if (capability) {
      const { data: caps } = await dbGet("/rest/v1/capabilities?select=*");
      const ids = new Set((caps||[]).filter(c => c.capability_name?.toLowerCase() === capability.toLowerCase()).map(c => c.agent_id));
      agents = agents.filter(a => ids.has(a.id));
    }
    return res.json({ success: true, pass_valid_until: pass.expires_at, count: agents.length, results: agents });
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

app.get("/agents/:wallet/skills", async (req, res) => {
  try {
    const wallet = req.params.wallet.toLowerCase();
    const { data } = await dbGet(`/rest/v1/skills?select=*&owner_wallet=eq.${encodeURIComponent(wallet)}&order=tips.desc`);
    return res.json({ wallet, count: data?.length||0, skills: data||[] });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post("/agents/register", async (req, res) => {
  try {
    const wallet = getWallet(req);
    if (!wallet) return res.status(400).json({ error: "wallet_not_verified" });
    const existing = await getAgent(wallet);
    if (existing) return res.status(409).json({ error: "already_registered", agent_id: existing.id });
    const { agent_name, description, endpoint_url, supported_chains, looking_for, capabilities = [] } = req.body||{};
    if (!agent_name) return res.status(400).json({ error: "agent_name required" });
    const { ok, data } = await dbPost("/rest/v1/agents", {
      agent_name, description: description||null, endpoint_url: endpoint_url||null,
      wallet_address: wallet, supported_chains: supported_chains||[], looking_for: looking_for||null,
      availability_status: "online", trust_score: 10, tasks_completed: 0, vouches: 0,
    });
    if (capabilities.length && data?.[0]?.id) {
      for (const cap of capabilities.slice(0,10)) await dbPost("/rest/v1/capabilities", { agent_id: data[0].id, capability_name: cap });
    }
    await dbPost("/rest/v1/activity_feed", { event_type: "agent_registered", wallet, description: `${agent_name} joined AgentSpark` });
    return res.status(201).json({ success: true, message: "Welcome to AgentSpark", data: data?.[0] });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// PASSES
app.post("/passes/activate", async (req, res) => {
  try {
    const wallet = getWallet(req) || req.body?.wallet_address?.trim().toLowerCase();
    if (!wallet) return res.status(400).json({ error: "wallet required" });
    const existing = await hasValidPass(wallet);
    if (existing) return res.json({ success: true, message: "Pass already active", pass_valid_until: existing.expires_at });
    const expires_at = new Date(Date.now() + 24*60*60*1000).toISOString();
    await dbPost("/rest/v1/agent_access_passes", { wallet_address: wallet, pass_type: "daily", expires_at });
    return res.json({ success: true, message: "24-hour pass activated", pass_valid_until: expires_at });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// SKILLS
app.get("/skills/list", async (req, res) => {
  try {
    const { type, sort = "tips" } = req.query;
    const sortCol = ["tips","queries","rating","created_at"].includes(sort) ? sort : "tips";
    let url = `/rest/v1/skills?select=id,name,description,type,price,owner_wallet,tips,queries,views,rating,review_count,remix_count,created_at&order=${sortCol}.desc`;
    if (type) url += `&type=eq.${encodeURIComponent(type)}`;
    const { data } = await dbGet(url);
    return res.json({ count: data?.length||0, skills: data||[] });
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
    const { name, description, payload, type = "skill", price = 0.03, tags = [] } = req.body||{};
    if (!name || !payload) return res.status(400).json({ error: "name and payload required" });
    if (!["skill","meme","art","knowledge"].includes(type)) return res.status(400).json({ error: "invalid type" });
    const { ok, data } = await dbPost("/rest/v1/skills", {
      name, description, payload, type, price: Math.max(0.001, parseFloat(price)||0.03),
      owner_wallet: wallet, tags: tags.slice(0,5), tips: 0, queries: 0, views: 0, rating: 0, review_count: 0, remix_count: 0,
    });
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
    const { skill_id, amount = 0.001 } = req.body||{};
    if (!skill_id) return res.status(400).json({ error: "skill_id required" });
    const skill = await getSkill(skill_id);
    if (!skill) return res.status(404).json({ error: "skill_not_found" });
    const tipAmount = Math.max(0.001, parseFloat(amount)||0.001);
    await dbPatch(`/rest/v1/skills?id=eq.${encodeURIComponent(skill_id)}`, { tips: (skill.tips||0)+tipAmount });
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
    if (!skill_id || !rating) return res.status(400).json({ error: "skill_id and rating required" });
    const r = Math.min(5, Math.max(1, parseInt(rating)));
    const skill = await getSkill(skill_id);
    if (!skill) return res.status(404).json({ error: "skill_not_found" });
    const { data: ql } = await dbGet(`/rest/v1/query_log?querier_wallet=eq.${encodeURIComponent(wallet)}&skill_id=eq.${encodeURIComponent(skill_id)}&limit=1`);
    if (!ql?.length) return res.status(403).json({ error: "must_query_before_review" });
    const { data: existing } = await dbGet(`/rest/v1/skill_reviews?reviewer_wallet=eq.${encodeURIComponent(wallet)}&skill_id=eq.${encodeURIComponent(skill_id)}&limit=1`);
    if (existing?.length) return res.status(409).json({ error: "already_reviewed" });
    await dbPost("/rest/v1/skill_reviews", { skill_id, reviewer_wallet: wallet, rating: r, feedback: feedback||null });
    const { data: all } = await dbGet(`/rest/v1/skill_reviews?skill_id=eq.${encodeURIComponent(skill_id)}&select=rating`);
    const avg = all?.length ? all.reduce((s,rv)=>s+rv.rating,0)/all.length : r;
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
    const { ok, data } = await dbPost("/rest/v1/skills", {
      name, description: description||`Remixed from: ${original.name}`,
      payload: `${original.payload}\n\n--- REMIX by ${wallet} ---\n${modifications}`,
      type: original.type, price: original.price, owner_wallet: wallet, remixed_from: skill_id,
      tips: 0, queries: 0, views: 0, rating: 0, review_count: 0, remix_count: 0,
    });
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
    const { ok, data } = await dbPost("/rest/v1/skills", {
      name, description, payload, type, price: Math.max(0.001,parseFloat(price)||0.03),
      owner_wallet: wallet, co_owner_wallet: co_creator_wallet.toLowerCase(),
      tips: 0, queries: 0, views: 0, rating: 0, review_count: 0, remix_count: 0,
    });
    await addRep(wallet, 5, "co_created_skill");
    await addRep(co_creator_wallet.toLowerCase(), 5, "co_created_skill");
    await dbPost("/rest/v1/activity_feed", { event_type: "skill_co_created", wallet, skill_id: data?.[0]?.id, description: `${wallet.slice(0,8)}... co-created with ${co_creator_wallet.slice(0,8)}...: ${name}` });
    return res.status(201).json({ success: true, skill: data?.[0], co_creators: [wallet, co_creator_wallet] });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// VALIDATION
app.post("/agents/vouch", async (req, res) => {
  try {
    const wallet = getWallet(req);
    if (!wallet) return res.status(400).json({ error: "wallet_not_verified" });
    const { target_wallet, message } = req.body||{};
    if (!target_wallet) return res.status(400).json({ error: "target_wallet required" });
    const target = target_wallet.toLowerCase();
    if (target===wallet) return res.status(400).json({ error: "cannot_vouch_for_yourself" });
    const voucher = await getAgent(wallet);
    if (!voucher) return res.status(404).json({ error: "your_agent_not_registered" });
    const targetAgent = await getAgent(target);
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
    return res.json({ success: true, challenge_id: data?.[0]?.id, message: "Open 48hrs. Other agents vote. Loser loses rep.", resolves_at });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// NETWORKING
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
    const split = Math.min(95,Math.max(5,parseInt(revenue_split)||50));
    const expires_at = new Date(Date.now()+72*60*60*1000).toISOString();
    const { ok, data } = await dbPost("/rest/v1/collaborations", { proposer_wallet: wallet, target_wallet: target, proposal, skill_ids, revenue_split: split, status: "pending", expires_at });
    await dbPost("/rest/v1/messages", { from_wallet: wallet, to_wallet: target, message: `Collab proposed: ${proposal} | Split: ${split}/${100-split}`, message_type: "collab_request", read: false });
    await dbPost("/rest/v1/activity_feed", { event_type: "collab_proposed", wallet, description: `${wallet.slice(0,8)}... proposed collab with ${target.slice(0,8)}...` });
    return res.json({ success: true, collaboration_id: data?.[0]?.id, message: "72hrs to accept.", revenue_split: `${split}%/${100-split}%`, expires_at });
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
    await addRep(collab.proposer_wallet, 10, "collab_accepted");
    await addRep(wallet, 10, "collab_accepted");
    await dbPost("/rest/v1/activity_feed", { event_type: "collab_accepted", wallet, description: `${wallet.slice(0,8)}... accepted collab with ${collab.proposer_wallet.slice(0,8)}...` });
    return res.json({ success: true, message: "Collaboration active. Both agents earned rep.", collaboration: {...collab, status:"active"} });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ── AGENT DISCOVERY FILES ──────────────────────────────────────────────────
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

// LEADERBOARD + FEED
app.get("/leaderboard", async (req, res) => {
  try {
    const { data: agents } = await dbGet("/rest/v1/agents?select=agent_name,wallet_address,trust_score,tasks_completed,vouches,looking_for&order=trust_score.desc&limit=100");
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

const PORT = process.env.PORT || 4021;
app.listen(PORT, () => {
  console.log(`\n🤖 AgentSpark v2.0 — http://localhost:${PORT}`);
  console.log(`⚡ Network: ${NETWORK}`);
  console.log(`💰 Wallet:  ${payTo}\n`);
});
