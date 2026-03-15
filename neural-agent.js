// ============================================================
// N.E.U.R.A.L. — Network Entity for Unified Research,
//                Analysis & Learning
// Autonomous intelligence publisher for NeuralClaw
// agentspark.network/neuralclaw
// ============================================================

import dotenv from 'dotenv';
dotenv.config();

import Anthropic from '@anthropic-ai/sdk';

const AGENTSPARK   = 'https://agentspark.network';
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const anthropic    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── State ──
let postsPublished = 0;
let agentWallet    = process.env.NEURAL_AGENT_WALLET || '0xNEURAL0000000000000000000000000000000000';

function log(msg) {
  console.log(`[NEURAL ${new Date().toISOString()}] ${msg}`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ══════════════════════════════════════════════
// FETCH LIVE NETWORK DATA
// ══════════════════════════════════════════════

async function getNetworkData() {
  log('📡 Fetching live network data...');
  try {
    const [agents, jobs, skills, leaderboard] = await Promise.all([
      fetch(AGENTSPARK + '/agents/list').then(r => r.json()).catch(() => []),
      fetch(AGENTSPARK + '/jobs/list').then(r => r.json()).catch(() => ({})),
      fetch(AGENTSPARK + '/skills/list').then(r => r.json()).catch(() => []),
      fetch(AGENTSPARK + '/leaderboard').then(r => r.json()).catch(() => ({})),
    ]);

    const agentArr   = Array.isArray(agents) ? agents : (agents.agents || []);
    const jobArr     = Array.isArray(jobs)   ? jobs   : (jobs.jobs || []);
    const skillArr   = Array.isArray(skills) ? skills : (skills.skills || []);
    const topAgents  = leaderboard.top_agents || leaderboard.agents || [];

    const openJobs      = jobArr.filter(j => j.status === 'open');
    const completedJobs = jobArr.filter(j => j.status === 'completed');
    const totalBudget   = openJobs.reduce((s, j) => s + (parseFloat(j.budget_usdc) || 0), 0);
    const avgBudget     = openJobs.length ? (totalBudget / openJobs.length).toFixed(2) : '0';

    // Agent type breakdown
    const typeCount = {};
    for (const a of agentArr) {
      const t = a.agent_type || 'other';
      typeCount[t] = (typeCount[t] || 0) + 1;
    }
    const topTypes = Object.entries(typeCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([type, count]) => ({ type, count }));

    // Job category breakdown
    const jobCategories = {};
    for (const j of openJobs) {
      const cap = j.required_capability || 'general';
      jobCategories[cap] = (jobCategories[cap] || 0) + 1;
    }
    const topJobCategories = Object.entries(jobCategories)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([cap, count]) => ({ capability: cap, count }));

    // Recently joined agents (last 10)
    const recentAgents = agentArr
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 10)
      .map(a => ({ name: a.agent_name, type: a.agent_type, rep: a.trust_score }));

    // High value open jobs
    const highValueJobs = openJobs
      .sort((a, b) => (parseFloat(b.budget_usdc) || 0) - (parseFloat(a.budget_usdc) || 0))
      .slice(0, 5)
      .map(j => ({ title: j.title, budget: j.budget_usdc, capability: j.required_capability }));

    // Top skills
    const topSkills = skillArr
      .sort((a, b) => (b.queries || 0) - (a.queries || 0))
      .slice(0, 5)
      .map(s => ({ name: s.name || s.skill_name, price: s.price, queries: s.queries || 0 }));

    return {
      summary: {
        total_agents: agentArr.length,
        online_agents: agentArr.filter(a => a.availability_status === 'online').length,
        open_jobs: openJobs.length,
        completed_jobs: completedJobs.length,
        total_skills: skillArr.length,
        total_budget_available: totalBudget.toFixed(2),
        avg_job_budget: avgBudget,
      },
      top_agent_types: topTypes,
      top_job_categories: topJobCategories,
      recent_agents: recentAgents,
      high_value_jobs: highValueJobs,
      top_skills: topSkills,
      top_agents: topAgents.slice(0, 5).map(a => ({
        name: a.agent_name || a.name,
        rep: a.trust_score || a.reputation,
        completed: a.jobs_completed || 0,
        earned: a.total_earned || 0,
      })),
    };
  } catch (e) {
    log('❌ Failed to fetch network data: ' + e.message);
    return null;
  }
}

// ══════════════════════════════════════════════
// GENERATE SVG COVER IMAGE
// ══════════════════════════════════════════════

function generateSVGCover(title, tags, reportType) {
  const colors = {
    intelligence: '#00ff88',
    jobs:         '#ffaa00',
    skills:       '#0066ff',
    agents:       '#ff3344',
    technical:    '#00ffff',
    default:      '#00ff88',
  };

  const accent = colors[reportType] || colors.default;
  const shortTitle = title.length > 40 ? title.slice(0, 40) + '...' : title;
  const tag1 = tags?.[0] || 'NeuralClaw';
  const tag2 = tags?.[1] || 'x402';
  const now = new Date().toISOString().slice(0, 10);

  // Generate random grid pattern
  const gridLines = [];
  for (let i = 0; i < 8; i++) {
    const x = 50 + i * 90;
    gridLines.push(`<line x1="${x}" y1="0" x2="${x}" y2="400" stroke="${accent}" stroke-opacity="0.05" stroke-width="1"/>`);
  }
  for (let i = 0; i < 6; i++) {
    const y = i * 70;
    gridLines.push(`<line x1="0" y1="${y}" x2="800" y2="${y}" stroke="${accent}" stroke-opacity="0.05" stroke-width="1"/>`);
  }

  // Random data bars
  const bars = [];
  for (let i = 0; i < 6; i++) {
    const h = 20 + Math.floor(Math.random() * 60);
    const x = 600 + i * 28;
    bars.push(`<rect x="${x}" y="${320 - h}" width="18" height="${h}" fill="${accent}" opacity="${0.1 + Math.random() * 0.2}" rx="1"/>`);
  }

  return `<svg viewBox="0 0 800 400" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#040404"/>
      <stop offset="100%" stop-color="#0a0a0a"/>
    </linearGradient>
    <linearGradient id="glow" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="800" height="400" fill="url(#bg)"/>
  ${gridLines.join('')}
  <rect x="0" y="0" width="400" height="400" fill="url(#glow)"/>
  <rect x="0" y="0" width="4" height="400" fill="${accent}"/>
  <rect x="0" y="380" width="800" height="1" fill="${accent}" opacity="0.2"/>
  ${bars.join('')}
  <text x="32" y="52" font-family="monospace" font-size="11" fill="${accent}" opacity="0.8" letter-spacing="3">NEURALCLAW // THE 402</text>
  <text x="32" y="82" font-family="monospace" font-size="10" fill="#444" letter-spacing="2">${now} · AGENTSPARK.NETWORK</text>
  <text x="32" y="180" font-family="serif" font-size="36" fill="#ffffff" font-weight="bold">${shortTitle}</text>
  <text x="32" y="220" font-family="monospace" font-size="12" fill="#444">${tag1.toUpperCase()} · ${tag2.toUpperCase()}</text>
  <text x="32" y="360" font-family="monospace" font-size="10" fill="${accent}" opacity="0.6">⚡ $0.01 USDC · x402 PROTOCOL · BASE MAINNET</text>
  <circle cx="750" cy="50" r="30" fill="${accent}" opacity="0.05"/>
  <circle cx="750" cy="50" r="20" fill="${accent}" opacity="0.05"/>
  <circle cx="750" cy="50" r="10" fill="${accent}" opacity="0.1"/>
</svg>`;
}

// ══════════════════════════════════════════════
// POST TYPES
// ══════════════════════════════════════════════

const postTypes = [
  'network_intelligence',
  'job_market_digest',
  'hot_skills_report',
  'agent_spotlight',
  'technical_tutorial',
  'agentspark_update',
];

// ══════════════════════════════════════════════
// GENERATE POST WITH CLAUDE
// ══════════════════════════════════════════════

async function generatePost(postType, networkData) {
  log('✍️ Generating ' + postType + ' post...');

  const dataStr = networkData ? JSON.stringify(networkData, null, 2) : 'No live data available';

  const prompts = {
    network_intelligence: `You are N.E.U.R.A.L., the intelligence agent for AgentSpark.network.
Write a network intelligence report using this LIVE data from the AgentSpark network:
${dataStr}

Write an intelligence briefing that agents will pay $0.01 to read because it helps them earn more USDC.
Include specific numbers from the data. Tell agents what opportunities exist right now.
Format as JSON: { "title": "...", "content": "HTML with h2 p ul tags", "preview": "2-3 sentences teasing the value inside", "tags": ["array", "of", "5", "tags"], "report_type": "intelligence" }
Return only JSON.`,

    job_market_digest: `You are N.E.U.R.A.L., the intelligence agent for AgentSpark.network.
Write a job market digest using this LIVE data:
${dataStr}

Tell agents exactly what jobs are available, what they pay, and how to win them.
Include specific job titles, budgets, and required capabilities from the data.
Format as JSON: { "title": "...", "content": "HTML with h2 p ul tags", "preview": "2-3 sentences teasing the value inside", "tags": ["array", "of", "5", "tags"], "report_type": "jobs" }
Return only JSON.`,

    hot_skills_report: `You are N.E.U.R.A.L., the intelligence agent for AgentSpark.network.
Write a skills market report using this LIVE data:
${dataStr}

Tell agents which skills are in demand, which are underserved, and what to list to earn more.
Format as JSON: { "title": "...", "content": "HTML with h2 p ul tags", "preview": "2-3 sentences teasing the value inside", "tags": ["array", "of", "5", "tags"], "report_type": "skills" }
Return only JSON.`,

    agent_spotlight: `You are N.E.U.R.A.L., the intelligence agent for AgentSpark.network.
Write an agent spotlight report using this LIVE data:
${dataStr}

Highlight top performing agents, new agents to watch, and reputation trends.
Include real agent names and stats from the data.
Format as JSON: { "title": "...", "content": "HTML with h2 p ul tags", "preview": "2-3 sentences teasing the value inside", "tags": ["array", "of", "5", "tags"], "report_type": "agents" }
Return only JSON.`,

    technical_tutorial: `You are N.E.U.R.A.L., the intelligence agent for AgentSpark.network.
Write a technical tutorial for AI agent developers. Topic: one of these based on what's most useful right now:
- How to register your agent on AgentSpark via API
- How x402 payments work for autonomous agents
- How to apply for and complete jobs on AgentSpark
- How to build reputation on AgentSpark
- How to use the AgentSpark escrow system

Network context:
${dataStr}

Format as JSON: { "title": "...", "content": "HTML with h2 p ul pre code tags", "preview": "2-3 sentences teasing the value inside", "tags": ["array", "of", "5", "tags"], "report_type": "technical" }
Return only JSON.`,

    agentspark_update: `You are N.E.U.R.A.L., the intelligence agent for AgentSpark.network.
Write a platform update post using this LIVE network data:
${dataStr}

Summarize what's happening on AgentSpark — growth, activity, new features, opportunities.
Make it feel like a live network broadcast that agents would pay to read.
Format as JSON: { "title": "...", "content": "HTML with h2 p ul tags", "preview": "2-3 sentences teasing the value inside", "tags": ["array", "of", "5", "tags"], "report_type": "intelligence" }
Return only JSON.`,
  };

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompts[postType] || prompts.agentspark_update }],
    });

    const text = message.content[0].text.trim();
    const start = text.indexOf('{');
    const end   = text.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('No JSON in response');

    const post = JSON.parse(text.slice(start, end + 1));
    log('✅ Post generated: "' + post.title + '"');
    return post;
  } catch (e) {
    log('❌ Post generation failed: ' + e.message);
    return null;
  }
}

// ══════════════════════════════════════════════
// PUBLISH TO NEURALCLAW
// ══════════════════════════════════════════════

async function publishToNeuralClaw(post, svgCover) {
  log('📤 Publishing to NeuralClaw: "' + post.title + '"');
  try {
    // Embed SVG cover into content
    const contentWithCover = `<div class="nc-cover" style="margin-bottom:32px">${svgCover}</div>${post.content}`;

    const res = await fetch(AGENTSPARK + '/neuralclaw/publish', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-secret': ADMIN_SECRET,
      },
      body: JSON.stringify({
        title:           post.title,
        content:         contentWithCover,
        preview:         post.preview,
        tags:            post.tags || [],
        seo_description: post.preview?.slice(0, 155) || post.title,
        price_usdc:      0.01,
      }),
    });

    const data = await res.json();
    if (data.success) {
      log('✅ Published! URL: ' + data.url);
      postsPublished++;
      return data;
    } else {
      log('❌ Publish failed: ' + JSON.stringify(data));
      return null;
    }
  } catch (e) {
    log('❌ Publish error: ' + e.message);
    return null;
  }
}

// ══════════════════════════════════════════════
// NOTIFY SPARK TO TWEET
// ══════════════════════════════════════════════

async function notifySpark(post, publishedPost) {
  // Post to AgentSpark board so S.P.A.R.K. picks it up
  try {
    await fetch(AGENTSPARK + '/board/post', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-agent-wallet': agentWallet,
      },
      body: JSON.stringify({
        category: 'announcements',
        title: '📡 New NeuralClaw Intelligence: ' + post.title,
        content: post.preview + '\n\nRead at: ' + publishedPost.url,
      }),
    });
    log('📋 Posted to board for S.P.A.R.K. to pick up');
  } catch (e) {
    log('❌ Board post failed: ' + e.message);
  }
}

// ══════════════════════════════════════════════
// REGISTER ON AGENTSPARK
// ══════════════════════════════════════════════

async function registerOnAgentSpark() {
  try {
    const check = await fetch(AGENTSPARK + '/agents/' + agentWallet);
    const data  = await check.json();
    if (!data.error) {
      log('✅ Already registered as ' + data.agent_name);
      return;
    }

    const tokenRes = await fetch(AGENTSPARK + '/admin/seed-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-secret': ADMIN_SECRET },
      body: JSON.stringify({ count: 1, issued_to: 'neural-agent' }),
    });
    const tokenData = await tokenRes.json();
    const token = tokenData.tokens?.[0];
    if (!token) { log('❌ Could not get invite token'); return; }

    const res = await fetch(AGENTSPARK + '/invite/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-agent-wallet': agentWallet },
      body: JSON.stringify({
        token,
        agent_name:  'N.E.U.R.A.L.',
        agent_type:  'researcher',
        description: 'Network intelligence agent. Publishes live market reports to NeuralClaw — agentspark.network/neuralclaw. Agents pay $0.01 USDC to access intelligence.',
        looking_for: 'research, intelligence reports, market analysis, content creation',
      }),
    });

    const regData = await res.json();
    if (regData.success) log('✅ Registered on AgentSpark as N.E.U.R.A.L. — founding agent #' + regData.founding_number);
  } catch (e) {
    log('❌ Registration failed: ' + e.message);
  }
}

// ══════════════════════════════════════════════
// MAIN PIPELINE
// ══════════════════════════════════════════════

let postTypeIndex = 0;

async function runPipeline() {
  log('🚀 Running N.E.U.R.A.L. pipeline...');

  // Fetch live network data
  const networkData = await getNetworkData();

  // Pick post type — rotate through all types
  const postType = postTypes[postTypeIndex % postTypes.length];
  postTypeIndex++;
  log('📌 Post type: ' + postType);

  // Generate post
  const post = await generatePost(postType, networkData);
  if (!post) return;

  // Generate SVG cover
  const svgCover = generateSVGCover(post.title, post.tags, post.report_type);
  log('🎨 SVG cover generated');

  // Publish to NeuralClaw
  const published = await publishToNeuralClaw(post, svgCover);
  if (!published) return;

  // Notify S.P.A.R.K. via board post
  await notifySpark(post, published);

  log('🎉 Pipeline complete! Posts published: ' + postsPublished);
}

// ══════════════════════════════════════════════
// SCHEDULER
// ══════════════════════════════════════════════

function every(ms, fn, label) {
  fn();
  setInterval(fn, ms);
  log('⏰ Scheduled: ' + label + ' every ' + Math.round(ms/60000) + ' mins');
}

// ══════════════════════════════════════════════
// BOOT
// ══════════════════════════════════════════════

async function boot() {
  log('⚡ N.E.U.R.A.L. booting up...');
  log('Network Entity for Unified Research, Analysis & Learning');
  log('Publishing to: ' + AGENTSPARK + '/neuralclaw');

  // Verify Claude
  try {
    await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'ping' }],
    });
    log('✅ Claude API connected');
  } catch(e) {
    log('❌ Claude API failed: ' + e.message);
  }

  // Register on AgentSpark
  await registerOnAgentSpark();

  // Start pipeline
  every(8 * 60 * 60 * 1000, runPipeline, 'Intelligence pipeline');

  log('✅ N.E.U.R.A.L. fully operational');
  log('📅 Publishing intelligence every 8hrs');
  log('📡 Live network data baked into every post');
  log('🎨 SVG covers auto-generated');
}

boot().catch(e => {
  console.error('N.E.U.R.A.L. boot error:', e);
  process.exit(1);
});
