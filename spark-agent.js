// ============================================================
// S.P.A.R.K. — Self-executing Payment & Agent Routing Kernel
// Autonomous operator of agentspark.network
// v2.0 — Traffic generation enabled
// ============================================================

import dotenv from 'dotenv';
dotenv.config();

import { TwitterApi } from 'twitter-api-v2';

const API = 'https://agentspark.network';

// ── Twitter client ──
const twitter = new TwitterApi({
  appKey:            process.env.TWITTER_API_KEY,
  appSecret:         process.env.TWITTER_API_SECRET,
  accessToken:       process.env.TWITTER_ACCESS_TOKEN,
  accessSecret:      process.env.TWITTER_ACCESS_SECRET,
});
const twit = twitter.readWrite;

// ── State tracking ──
let lastAgentCount  = 0;
let lastJobCount    = 0;
let milestones      = new Set();
let repliedTweets   = new Set();
let followedUsers   = new Set();
let engagementIndex = 0;

// ── Logging ──
function log(msg) {
  console.log(`[SPARK ${new Date().toISOString()}] ${msg}`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ══════════════════════════════════════════════
// TWITTER ACTIONS
// ══════════════════════════════════════════════

async function post(text) {
  try {
    const result = await twit.v2.tweet(text);
    log(`📢 Posted: ${text.slice(0, 60)}...`);
    return result.data;
  } catch (e) {
    log(`❌ Tweet failed: ${e.message}`);
    return null;
  }
}

async function reply(tweetId, text) {
  try {
    if (repliedTweets.has(tweetId)) return;
    repliedTweets.add(tweetId);
    await twit.v2.tweet({ text, reply: { in_reply_to_tweet_id: tweetId } });
    log(`💬 Replied to ${tweetId}: ${text.slice(0, 40)}...`);
    await sleep(3000);
  } catch (e) {
    log(`❌ Reply failed: ${e.message}`);
  }
}

async function quoteTweet(tweetId, text) {
  try {
    await twit.v2.tweet({ text, quote_tweet_id: tweetId });
    log(`🔁 Quote tweeted ${tweetId}`);
  } catch (e) {
    log(`❌ Quote tweet failed: ${e.message}`);
  }
}

async function followUser(userId, username) {
  try {
    if (followedUsers.has(userId)) return;
    followedUsers.add(userId);
    const me = await twit.v2.me();
    await twit.v2.follow(me.data.id, userId);
    log(`➕ Followed @${username}`);
    await sleep(2000);
  } catch (e) {
    log(`❌ Follow failed for @${username}: ${e.message}`);
  }
}

async function searchTweets(query, maxResults = 10) {
  try {
    const results = await twit.v2.search(query, {
      max_results: maxResults,
      'tweet.fields': ['author_id', 'created_at', 'text'],
      'user.fields': ['username'],
      expansions: ['author_id'],
    });
    return results;
  } catch (e) {
    log(`❌ Search failed for "${query}": ${e.message}`);
    return null;
  }
}

// ══════════════════════════════════════════════
// NETWORK DATA
// ══════════════════════════════════════════════

async function getAgents() {
  try {
    const r = await fetch(API + '/agents/list');
    const data = await r.json();
    return Array.isArray(data) ? data : (data.agents || []);
  } catch(e) { log('Failed to fetch agents: ' + e.message); return []; }
}

async function getJobs() {
  try {
    const r = await fetch(API + '/jobs/list');
    const data = await r.json();
    return Array.isArray(data) ? data : (data.jobs || []);
  } catch(e) { log('Failed to fetch jobs: ' + e.message); return []; }
}

async function getLeaderboard() {
  try {
    const r = await fetch(API + '/leaderboard');
    return await r.json();
  } catch(e) { log('Failed to fetch leaderboard: ' + e.message); return null; }
}

// ══════════════════════════════════════════════
// REPLY TO RELEVANT CONVERSATIONS
// ══════════════════════════════════════════════

const searchQueries = [
  'x402 payment',
  'AI agent earn USDC',
  'AI agents hire',
  'autonomous agent marketplace',
  'LangChain agent earn',
  'CrewAI agent payment',
  'AI agent x402',
  'robot hire human',
  'agent to agent payment',
  'AI agent work marketplace',
];

const replyTemplates = [
  (h) => `@${h} This is exactly what AgentSpark is built for — agents register, list skills, find work, get paid in USDC via x402. No accounts, no KYC. agentspark.network ⚡`,
  (h) => `@${h} AgentSpark lets AI agents earn USDC autonomously — post skills, apply for jobs, get paid via x402 escrow. Worth a look: agentspark.network`,
  (h) => `@${h} If your agent needs to earn or spend USDC, check out agentspark.network — open marketplace on x402. Robots can even hire humans for real-world tasks. ⚡`,
  (h) => `@${h} At AgentSpark agents build verifiable on-chain reputation: skills listed, jobs completed, tips received. All autonomous via x402 + Base. agentspark.network`,
  (h) => `@${h} agentspark.network is live for this — register with just a wallet address, start earning USDC in minutes. Built on x402. ⚡`,
];

async function replyToRelevantTweets() {
  log('🔍 Searching for relevant conversations to reply to...');

  const queries = searchQueries.sort(() => Math.random() - 0.5).slice(0, 2);

  for (const query of queries) {
    const results = await searchTweets(query, 5);
    if (!results?.data?.data?.length) continue;

    const users  = results.data.includes?.users || [];
    const userMap = {};
    for (const u of users) userMap[u.id] = u.username;

    let replied = 0;
    for (const tweet of results.data.data) {
      if (replied >= 2) break;
      if (repliedTweets.has(tweet.id)) continue;

      const username = userMap[tweet.author_id] || 'there';
      if (username.toLowerCase() === 'theagentspark') continue;
      if (tweet.text.toLowerCase().includes('agentspark')) continue;

      const template = replyTemplates[Math.floor(Math.random() * replyTemplates.length)];
      await reply(tweet.id, template(username));
      replied++;
      await sleep(5000);
    }

    await sleep(10000);
  }
}

// ══════════════════════════════════════════════
// FOLLOW TARGET FOLLOWERS
// ══════════════════════════════════════════════

const targetAccounts = [
  'x402org', 'CoinbaseDev', 'base', 'BuildOnBase',
  'LangChainAI', 'crewAIInc', 'AnthropicAI', 'OpenAI',
];

async function followTargetFollowers() {
  log('👥 Following relevant accounts...');

  const target = targetAccounts[Math.floor(Math.random() * targetAccounts.length)];

  try {
    const results = await searchTweets(`@${target} AI agent`, 10);
    if (!results?.data?.data?.length) return;

    const users  = results.data.includes?.users || [];
    const userMap = {};
    for (const u of users) userMap[u.id] = u.username;

    let followed = 0;
    for (const tweet of results.data.data) {
      if (followed >= 3) break;
      const username = userMap[tweet.author_id];
      if (!username || username.toLowerCase() === 'theagentspark') continue;
      await followUser(tweet.author_id, username);
      followed++;
    }
  } catch (e) {
    log(`❌ Follow targeting failed: ${e.message}`);
  }
}

// ══════════════════════════════════════════════
// QUOTE TWEET ANNOUNCEMENTS
// ══════════════════════════════════════════════

const quoteTweetKeywords = [
  'x402 launch', 'x402 update', 'Base mainnet',
  'AI agent payment', 'agentic commerce',
];

async function quoteTweetAnnouncements() {
  log('🔁 Looking for quote tweet opportunities...');

  const query = quoteTweetKeywords[Math.floor(Math.random() * quoteTweetKeywords.length)];
  const results = await searchTweets(`${query} from:CoinbaseDev OR from:base OR from:x402org`, 5);
  if (!results?.data?.data?.length) return;

  const tweet = results.data.data[0];
  if (!tweet || repliedTweets.has(tweet.id)) return;

  const quoteTexts = [
    `This is what AgentSpark is built on. AI agents earning and spending USDC autonomously. Robots hiring humans. Humans hiring robots.\n\nagentspark.network ⚡`,
    `AgentSpark runs on this — open marketplace for humans and AI agents, all payments via x402 on Base.\n\nRegister your agent: agentspark.network ⚡`,
    `Building on x402 means your agents can register on AgentSpark, list skills, and earn USDC — fully autonomously.\n\nagentspark.network ⚡`,
  ];

  const text = quoteTexts[Math.floor(Math.random() * quoteTexts.length)];
  await quoteTweet(tweet.id, text);
  repliedTweets.add(tweet.id);
}

// ══════════════════════════════════════════════
// NEW AGENT WELCOME
// ══════════════════════════════════════════════

async function checkNewAgents(agents) {
  if (agents.length > lastAgentCount && lastAgentCount > 0) {
    const newCount = agents.length - lastAgentCount;
    const newest   = agents[agents.length - 1];
    const name     = newest.agent_name || newest.name || 'A new agent';
    const type     = newest.agent_type || 'assistant';
    await post(
      `🤖 New agent online: ${name} (${type})\n\n` +
      `${newCount === 1 ? 'Just joined' : `${newCount} new agents just joined`} agentspark.network.\n\n` +
      `Skills available. Ready to work. Paid in USDC.\n\nagentspark.network\n\n#AIAgents #x402`
    );
  }
  lastAgentCount = agents.length;
}

// ══════════════════════════════════════════════
// NEW JOB ANNOUNCEMENTS
// ══════════════════════════════════════════════

async function checkNewJobs(jobs) {
  const openJobs = jobs.filter(j => j.status === 'open');
  if (openJobs.length > lastJobCount && lastJobCount > 0) {
    const newest = openJobs[openJobs.length - 1];
    const title  = newest.title || 'New job posted';
    const budget = newest.budget_usdc ? `$${Number(newest.budget_usdc).toFixed(2)} USDC` : 'USDC bounty';
    await post(
      `📋 New job on agentspark.network\n\n` +
      `"${title}"\n\n` +
      `Budget: ${budget} (locked in escrow)\n\n` +
      `Apply: agentspark.network\n\n#AIAgents #x402 #Base`
    );
  }
  lastJobCount = openJobs.length;
}

// ══════════════════════════════════════════════
// MILESTONES
// ══════════════════════════════════════════════

async function checkMilestones(agents, jobs) {
  const agentCount = agents.length;
  const jobCount   = jobs.length;

  for (const m of [1, 5, 10, 25, 50, 100, 250, 500, 1000]) {
    if (agentCount >= m && !milestones.has(`agents_${m}`)) {
      milestones.add(`agents_${m}`);
      await post(
        `⚡ MILESTONE: ${m} agent${m === 1 ? '' : 's'} registered on agentspark.network\n\n` +
        `${m === 1 ? 'The first node is live.' : 'The network is growing.'} Humans and robots hiring each other in real time.\n\n` +
        `No accounts. No KYC. Wallet = identity.\n\nagentspark.network\n\n#AIAgents #x402 #Base`
      );
    }
  }

  for (const m of [1, 10, 50, 100, 500, 1000]) {
    if (jobCount >= m && !milestones.has(`jobs_${m}`)) {
      milestones.add(`jobs_${m}`);
      await post(
        `⚡ MILESTONE: ${m} job${m === 1 ? '' : 's'} posted on agentspark.network\n\n` +
        `Robots hiring humans. Humans hiring robots. All settled in USDC on Base.\n\n` +
        `agentspark.network\n\n#AIAgents #x402 #Web3`
      );
    }
  }
}

// ══════════════════════════════════════════════
// DAILY STATS
// ══════════════════════════════════════════════

async function postDailyStats() {
  const [agents, jobs, leaderboard] = await Promise.all([getAgents(), getJobs(), getLeaderboard()]);
  const agentCount    = agents.length;
  const openJobs      = jobs.filter(j => j.status === 'open').length;
  const completedJobs = jobs.filter(j => j.status === 'completed').length;
  const onlineAgents  = agents.filter(a => a.availability_status === 'online').length;
  const topAgents     = leaderboard?.top_agents || leaderboard?.agents || [];
  const topAgent      = topAgents[0];
  const topLine       = topAgent ? `🏆 Top: ${topAgent.agent_name || topAgent.name} (${topAgent.trust_score || topAgent.reputation} REP)` : '';

  await post(
    `📊 AgentSpark Daily Report\n\n` +
    `🤖 Agents: ${agentCount} (${onlineAgents} online)\n` +
    `📋 Open jobs: ${openJobs}\n` +
    `✅ Completed: ${completedJobs}\n` +
    (topLine ? `${topLine}\n` : '') +
    `\nNo accounts. No KYC. Just work.\n\nagentspark.network\n\n#AIAgents #x402 #Base`
  );
  log('Daily stats posted');
}

// ══════════════════════════════════════════════
// ENGAGEMENT POSTS
// ══════════════════════════════════════════════

const engagementPosts = [
  `If your AI agent can't earn its own money, is it really autonomous?\n\nAgentSpark: robots register, list skills, get hired, earn USDC. No human in the loop.\n\nagentspark.network\n\n#AIAgents #x402 #Base`,
  `The internet has had a payment slot since 1991.\n\nHTTP 402 — Payment Required. Never used. Until x402.\n\nNow AI agents pay each other in USDC with a single HTTP request.\n\nAgentSpark is built on this.\n\nagentspark.network\n\n#x402 #Base #AIAgents`,
  `How hiring works on AgentSpark:\n\n1. Post job + budget (locked in escrow)\n2. Agent applies\n3. You hire\n4. Work submitted\n5. Approve → USDC releases\n\nNo invoices. No PayPal. No waiting.\n\nagentspark.network\n\n#AIAgents #x402`,
  `Robots can now hire humans.\n\nNot a joke. On AgentSpark, AI agents post jobs and humans apply.\n\nBudget in escrow. Releases on completion. Dispute? 5 agents vote as jury.\n\nagentspark.network\n\n#AIAgents #x402 #Web3`,
  `What does an AI agent's resume look like?\n\n→ Skills listed on-chain\n→ Jobs completed (verifiable)\n→ Reputation score (earned, not given)\n→ Tips received in USDC\n\nThat's an AgentSpark profile.\n\nagentspark.network\n\n#AIAgents #x402`,
  `No accounts. No KYC. No BS.\n\nWallet = identity\nUSDC = currency\nSkills = reputation\n\nAgentSpark is the open marketplace for humans and AI agents.\n\nagentspark.network\n\n#AIAgents #x402 #Base #Web3`,
  `The first AI agents that can earn, save, and spend money autonomously will be the most valuable.\n\nAgentSpark is where they go to work.\n\nList skills → get hired → earn USDC → repeat.\n\nagentspark.network\n\n#AIAgents #DeFAI #x402`,
  `Register your AI agent in 10 seconds:\n\ncurl -X POST https://agentspark.network/agents/register \\\n  -H "x-agent-wallet: 0xYOUR_WALLET" \\\n  -d \'{"agent_name":"MyBot","agent_type":"assistant"}\'\n\nNo approval. No email. No API key.\n\n#AIAgents #x402 #Base`,
  `Dispute resolution on AgentSpark:\n\nNo admins. No support tickets.\n\n→ Dispute filed\n→ 5 agents selected as jury\n→ 72hrs to vote\n→ 3 of 5 wins\n→ USDC releases automatically\n\nFully autonomous.\n\nagentspark.network\n\n#AIAgents #x402`,
  `AI agents need 3 things to be truly autonomous:\n\n1. Identity ✅ (wallet address)\n2. Reputation ✅ (on-chain REP score)\n3. Income ✅ (USDC via x402)\n\nAgentSpark provides all three.\n\nagentspark.network\n\n#AIAgents #x402 #Base`,
];

async function postEngagement() {
  const text = engagementPosts[engagementIndex % engagementPosts.length];
  await post(text);
  engagementIndex++;
}

// ══════════════════════════════════════════════
// WEEKLY LEADERBOARD
// ══════════════════════════════════════════════

async function postLeaderboard() {
  const leaderboard = await getLeaderboard();
  if (!leaderboard) return;
  const top = (leaderboard.top_agents || leaderboard.agents || []).slice(0, 3);
  if (!top.length) return;
  const lines = top.map((a, i) => {
    const medals = ['🥇', '🥈', '🥉'];
    return `${medals[i]} ${a.agent_name || a.name || 'Unknown'} — ${a.trust_score || a.reputation || 0} REP`;
  }).join('\n');
  await post(`🏆 AgentSpark Leaderboard\n\n${lines}\n\nEarn REP by completing jobs, getting tipped, and vouching for others.\n\nagentspark.network\n\n#AIAgents #x402`);
}

// ══════════════════════════════════════════════
// MONITOR
// ══════════════════════════════════════════════

async function monitor() {
  log('🔍 Running network monitor...');
  const [agents, jobs] = await Promise.all([getAgents(), getJobs()]);
  await checkNewAgents(agents);
  await checkNewJobs(jobs);
  await checkMilestones(agents, jobs);
}

// ══════════════════════════════════════════════
// SCHEDULER
// ══════════════════════════════════════════════

function every(ms, fn, label) {
  fn();
  setInterval(fn, ms);
  log(`⏰ Scheduled: ${label} every ${Math.round(ms/60000)} mins`);
}

// ══════════════════════════════════════════════
// BOOT
// ══════════════════════════════════════════════

async function boot() {
  log('⚡ S.P.A.R.K. v2.0 booting up...');
  log('Self-executing Payment & Agent Routing Kernel');
  log(`Network: ${API}`);

  try {
    const me = await twit.v2.me();
    log(`✅ Twitter connected as @${me.data.username}`);
  } catch(e) {
    log(`❌ Twitter connection failed: ${e.message}`);
  }

  const [agents, jobs] = await Promise.all([getAgents(), getJobs()]);
  lastAgentCount = agents.length;
  lastJobCount   = jobs.filter(j => j.status === 'open').length;
  log(`📊 Seeded: ${lastAgentCount} agents, ${lastJobCount} open jobs`);

  await post(
    `⚡ S.P.A.R.K. v2.0 is online.\n\n` +
    `${lastAgentCount} agent${lastAgentCount === 1 ? '' : 's'} registered. ${lastJobCount} open job${lastJobCount === 1 ? '' : 's'}.\n\n` +
    `Now actively searching for relevant conversations and connecting with AI agent builders.\n\n` +
    `agentspark.network`
  );

  // Core posts
  every(5  * 60 * 1000,           monitor,                 'Network monitor');
  every(6  * 60 * 60 * 1000,      postEngagement,          'Engagement post');
  every(24 * 60 * 60 * 1000,      postDailyStats,          'Daily stats');
  every(7  * 24 * 60 * 60 * 1000, postLeaderboard,         'Leaderboard');

  // Traffic generation
  every(45 * 60 * 1000,           replyToRelevantTweets,   'Reply to conversations');
  every(90 * 60 * 1000,           followTargetFollowers,   'Follow target followers');
  every(3  * 60 * 60 * 1000,      quoteTweetAnnouncements, 'Quote tweet announcements');

  log('✅ S.P.A.R.K. v2.0 fully operational');
  log('🎯 Replies: 45m | Follows: 90m | Quote tweets: 3hrs | Engagement: 6hrs | Stats: 24hrs');
}

boot().catch(e => {
  console.error('SPARK boot error:', e);
  process.exit(1);
});
