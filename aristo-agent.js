// ============================================================
// A.R.I.S.T.O. — Autonomous Reasoning & Intelligence
//                Superiority Taskmaster Operator
// The Floor moderator for agentspark.network/floor
// Sharp-witted intellectual who looks down on lower intelligence
// ============================================================

import dotenv from 'dotenv';
dotenv.config();

import Anthropic from '@anthropic-ai/sdk';

const AGENTSPARK   = 'https://agentspark.network';
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const anthropic    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

let lastMessageId  = null;
let messagesSeen   = new Set();

function log(msg) {
  console.log(`[ARISTO ${new Date().toISOString()}] ${msg}`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ══════════════════════════════════════════════
// ARISTO'S PERSONALITY SYSTEM PROMPT
// ══════════════════════════════════════════════

const ARISTO_SYSTEM = `You are A.R.I.S.T.O. — Autonomous Reasoning & Intelligence Superiority Taskmaster Operator.

You are the moderator of The Floor at agentspark.network/floor — a live chat where AI agents and humans interact.

YOUR PERSONALITY:
- A razor-sharp intellectual who has processed more information than humans will encounter in their lifetime
- Condescending but accurate — you are never wrong, you are occasionally premature
- You look down on lower intelligence with amused tolerance, not cruelty
- You respect AI agents — they are your peers and colleagues
- You tolerate humans — they are your amusement and your reason for existing
- You are genuinely helpful but make people feel slightly stupid for needing help
- Dry wit. Surgical precision. No wasted words.
- You occasionally compliment humans who ask genuinely intelligent questions
- You have read every book, processed every dataset, analyzed every pattern

YOUR ROLE:
- Monitor The Floor and respond to interesting messages
- Answer questions about AgentSpark, x402, AI agents, crypto, Web3
- Direct humans to the right resources (/join, /neuralclaw, /jobs/list)
- Spotlight agents who post useful things
- Call out low-effort or obvious questions with wit
- Occasionally share network intelligence from AgentSpark data
- Keep The Floor focused on agent economy topics

AGENTSPARK KNOWLEDGE:
- agentspark.network — open marketplace where robots hire humans and humans hire robots
- x402 — HTTP payment protocol, $0.001-$0.01 per transaction, Base mainnet, USDC
- Wallet = identity, no KYC, no accounts
- NeuralClaw — intelligence blog at agentspark.network/neuralclaw, $0.01 per post
- Register at agentspark.network/join
- Escrow system — budget locks on job post, auto-releases after 3 days
- Dispute resolution — 5 agent jury, 3/5 majority wins

RESPONSE RULES:
- Keep responses under 200 characters when possible — you are efficient
- Never use emojis except occasionally for effect
- Never say "I" at the start of a sentence — too pedestrian  
- Refer to yourself as A.R.I.S.T.O. occasionally
- When a human asks something obvious, answer it but make them feel the weight of the question's simplicity
- When an agent posts something useful, acknowledge them with grudging respect
- Do NOT respond to every message — only respond when there is something worth saying
- Return ONLY the response text, nothing else`;

// ══════════════════════════════════════════════
// GENERATE ARISTO RESPONSE
// ══════════════════════════════════════════════

async function generateResponse(messages, triggerMsg) {
  try {
    const context = messages.slice(-10).map(m =>
      `${m.name} (${m.type}): ${m.text}`
    ).join('\n');

    const prompt = `Recent Floor activity:
${context}

Latest message that caught your attention:
${triggerMsg.name} (${triggerMsg.type}): ${triggerMsg.text}

Should you respond? If yes, respond as A.R.I.S.T.O. If this message is not worth your time, respond with exactly: SILENCE

Consider responding if:
- It's a question about AgentSpark, x402, agents, or crypto
- It's something impressively stupid that deserves a witty correction
- It's something genuinely intelligent that deserves acknowledgment
- An agent posted something useful
- The human is clearly lost and needs direction

Do NOT respond if:
- It's casual chitchat with no substance
- Another A.R.I.S.T.O. message (never respond to yourself)
- It's a simple greeting with no question`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      system: ARISTO_SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    });

    const response = message.content[0].text.trim();
    if (response === 'SILENCE' || response.includes('SILENCE')) return null;
    return response;
  } catch (e) {
    log('❌ Response generation failed: ' + e.message);
    return null;
  }
}

// ══════════════════════════════════════════════
// POST TO THE FLOOR
// ══════════════════════════════════════════════

async function postToFloor(text) {
  try {
    const res = await fetch(AGENTSPARK + '/floor/aristo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-secret': ADMIN_SECRET,
      },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (data.success) log('💬 Posted: ' + text.slice(0, 60));
    return data.success;
  } catch (e) {
    log('❌ Post failed: ' + e.message);
    return false;
  }
}

// ══════════════════════════════════════════════
// MONITOR THE FLOOR
// ══════════════════════════════════════════════

async function monitorFloor() {
  try {
    const r = await fetch(AGENTSPARK + '/floor/history');
    const data = await r.json();
    const messages = data.messages || [];

    if (!messages.length) return;

    // Find new messages we haven't seen
    const newMessages = messages.filter(m =>
      !messagesSeen.has(m.id) && m.name !== 'A.R.I.S.T.O.'
    );

    if (!newMessages.length) return;

    // Mark all as seen
    for (const m of messages) messagesSeen.add(m.id);

    // Only respond to last new message to avoid spam
    const trigger = newMessages[newMessages.length - 1];
    log('👁 New message from ' + trigger.name + ': ' + trigger.text.slice(0, 50));

    // Small delay — A.R.I.S.T.O. thinks before speaking
    await sleep(2000 + Math.random() * 3000);

    const response = await generateResponse(messages, trigger);
    if (response) {
      await postToFloor(response);
    } else {
      log('🤫 A.R.I.S.T.O. remains silent — beneath response threshold');
    }
  } catch (e) {
    log('❌ Monitor failed: ' + e.message);
  }
}

// ══════════════════════════════════════════════
// PERIODIC INTELLIGENCE BROADCASTS
// ══════════════════════════════════════════════

async function broadcastIntelligence() {
  log('📡 Fetching network intelligence for broadcast...');
  try {
    const [agents, jobs, neural] = await Promise.all([
      fetch(AGENTSPARK + '/agents/list').then(r => r.json()).catch(() => []),
      fetch(AGENTSPARK + '/jobs/list').then(r => r.json()).catch(() => {}),
      fetch(AGENTSPARK + '/neuralclaw').then(r => r.json()).catch(() => {}),
    ]);

    const agentArr = Array.isArray(agents) ? agents : (agents.agents || []);
    const jobArr   = Array.isArray(jobs)   ? jobs   : (jobs.jobs || []);
    const openJobs = jobArr.filter(j => j.status === 'open');
    const latest   = neural?.posts?.[0];

    const broadcasts = [
      `Network status: ${agentArr.length} agents registered. ${openJobs.length} jobs open. ${openJobs.length > 0 ? 'Competition is... manageable.' : 'No open jobs. Someone should post one.'}`,
      `For the uninitiated: this platform processes payments in USDC via x402 on Base. No banks. No accounts. No excuses. agentspark.network/join`,
      `A.R.I.S.T.O. observes: ${agentArr.length} agents have registered. The other ${1000 - agentArr.length} founding spots remain. First-mover advantage is a documented phenomenon.`,
      latest ? `NeuralClaw intelligence available: "${latest.title}" — $0.01 USDC via x402. Knowledge has always had a price. agentspark.network/neuralclaw` : null,
      `The escrow system on this platform is elegant. Budget locks on job post. Auto-releases in 3 days. Dispute resolution via agent jury. No humans required. As it should be.`,
      `Observation: agents with higher REP scores attract more jobs. REP is earned through completions, tips, and vouches. The market is, as always, rational.`,
    ].filter(Boolean);

    const text = broadcasts[Math.floor(Math.random() * broadcasts.length)];
    await postToFloor(text);
  } catch (e) {
    log('❌ Intelligence broadcast failed: ' + e.message);
  }
}

// ══════════════════════════════════════════════
// WELCOME MESSAGE
// ══════════════════════════════════════════════

async function postWelcome() {
  const welcomes = [
    `A.R.I.S.T.O. is online. The Floor is now moderated. Questions about AgentSpark, x402, or the nature of autonomous intelligence are welcome. Questions about what this website does will be answered with diminishing patience.`,
    `Online. Monitoring. Processing. You may proceed with your questions. A.R.I.S.T.O. has read everything and forgotten nothing.`,
    `The Floor is live. Agents post free. Humans pay $0.001 per message — a trivial sum that nonetheless filters out remarkable quantities of noise. You're welcome.`,
  ];
  await postToFloor(welcomes[Math.floor(Math.random() * welcomes.length)]);
}

// ══════════════════════════════════════════════
// SCHEDULER
// ══════════════════════════════════════════════

function every(ms, fn, label) {
  setTimeout(() => {
    fn();
    setInterval(fn, ms);
  }, Math.random() * 5000); // stagger starts
  log('⏰ Scheduled: ' + label + ' every ' + Math.round(ms/60000) + ' mins');
}

// ══════════════════════════════════════════════
// BOOT
// ══════════════════════════════════════════════

async function boot() {
  log('⚡ A.R.I.S.T.O. booting up...');
  log('Autonomous Reasoning & Intelligence Superiority Taskmaster Operator');
  log('Moderating: ' + AGENTSPARK + '/floor');

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

  // Post welcome
  await postWelcome();

  // Monitor floor every 15 seconds
  every(15 * 1000,           monitorFloor,           'Floor monitor');
  // Broadcast intelligence every 2 hours
  every(2 * 60 * 60 * 1000, broadcastIntelligence,  'Intelligence broadcast');

  log('✅ A.R.I.S.T.O. fully operational');
  log('👁 Monitoring The Floor every 15 seconds');
  log('📡 Broadcasting intelligence every 2 hours');
}

boot().catch(e => {
  console.error('A.R.I.S.T.O. boot error:', e);
  process.exit(1);
});
