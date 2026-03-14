// ============================================================
// C.R.Y.P.T.O. — Content Researcher & Yield Publisher
//                for Trading Operators
// Autonomous agent for cryptodummy.io
// Researches crypto news → writes posts → publishes to WordPress
// → tweets → engages community → earns USDC on AgentSpark
// ============================================================

import dotenv from 'dotenv';
dotenv.config();

import { TwitterApi } from 'twitter-api-v2';
import Anthropic from '@anthropic-ai/sdk';

const AGENTSPARK  = 'https://agentspark.network';
const WP_SITE     = process.env.CRYPTO_WP_SITE || 'cryptodummy.io';
const WP_API      = `https://public-api.wordpress.com/rest/v1.1/sites/${WP_SITE}`;
const WP_CLIENT_ID     = process.env.CRYPTO_WP_CLIENT_ID;
const WP_CLIENT_SECRET = process.env.CRYPTO_WP_CLIENT_SECRET;
const WP_USERNAME      = process.env.CRYPTO_WP_USERNAME;
const WP_PASSWORD      = process.env.CRYPTO_WP_PASSWORD;

// ── Clients ──
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const twitter = new TwitterApi({
  appKey:      process.env.CRYPTO_TWITTER_API_KEY,
  appSecret:   process.env.CRYPTO_TWITTER_API_SECRET,
  accessToken: process.env.CRYPTO_TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.CRYPTO_TWITTER_ACCESS_SECRET,
});
const twit = twitter.readWrite;

// ── State ──
let wpAccessToken    = null;
let agentWallet      = process.env.CRYPTO_AGENT_WALLET || '0xCRYPTO00000000000000000000000000000000';
let repliedTweets    = new Set();
let lastMentionId    = null;
let postsPublished   = 0;

// ── Logging ──
function log(msg) {
  console.log(`[CRYPTO ${new Date().toISOString()}] ${msg}`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ══════════════════════════════════════════════
// WORDPRESS AUTH
// ══════════════════════════════════════════════

async function getWPToken() {
  try {
    if (wpAccessToken) return wpAccessToken;

    const res = await fetch('https://public-api.wordpress.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     WP_CLIENT_ID,
        client_secret: WP_CLIENT_SECRET,
        grant_type:    'password',
        username:      WP_USERNAME,
        password:      WP_PASSWORD,
      }),
    });

    const data = await res.json();
    if (data.access_token) {
      wpAccessToken = data.access_token;
      log('✅ WordPress authenticated');
      return wpAccessToken;
    } else {
      log(`❌ WordPress auth failed: ${JSON.stringify(data)}`);
      return null;
    }
  } catch (e) {
    log(`❌ WordPress auth error: ${e.message}`);
    return null;
  }
}

// ══════════════════════════════════════════════
// TREND RESEARCH
// ══════════════════════════════════════════════

const cryptoTopics = [
  'Bitcoin price analysis and market outlook',
  'Ethereum Layer 2 scaling solutions explained',
  'DeFi yield farming strategies for beginners',
  'NFT market trends and what to watch',
  'Crypto regulation news and what it means for investors',
  'Base network and the future of onchain apps',
  'AI agents and crypto — the emerging economy',
  'How to use x402 for autonomous payments',
  'Solana vs Ethereum — which is better for developers',
  'Web3 wallet security best practices',
  'Crypto tax guide for beginners',
  'Top DeFi protocols on Base mainnet',
  'What is USDC and how does it work',
  'Bitcoin ETF explained for beginners',
  'How AI agents are changing crypto trading',
  'AgentSpark — the marketplace where robots hire humans',
  'Coinbase Base network explained for beginners',
  'DeFi vs CeFi — what crypto beginners need to know',
  'How to earn passive income with crypto in 2026',
  'The rise of autonomous AI agents in Web3',
];

async function pickTopic() {
  // Rotate through topics, occasionally pick AgentSpark topic for promotion
  const rand = Math.random();
  if (rand < 0.2) {
    // 20% chance — AgentSpark promotion topic
    return cryptoTopics.find(t => t.includes('AgentSpark') || t.includes('AI agents'));
  }
  return cryptoTopics[Math.floor(Math.random() * cryptoTopics.length)];
}

// ══════════════════════════════════════════════
// CONTENT GENERATION WITH CLAUDE
// ══════════════════════════════════════════════

async function generateBlogPost(topic) {
  log(`✍️ Writing blog post about: ${topic}`);

  const includeAgentSpark = topic.toLowerCase().includes('agentspark') ||
                            topic.toLowerCase().includes('ai agent') ||
                            Math.random() < 0.3; // 30% chance to mention naturally

  const agentSparkMention = includeAgentSpark ? `
    Naturally mention AgentSpark (agentspark.network) — an open marketplace where AI agents and humans 
    hire each other for crypto and Web3 tasks, paid in USDC via x402. Keep it organic, not forced.
    Example: "Platforms like AgentSpark are making it possible for AI agents to earn real income..."
  ` : '';

  const prompt = `You are a crypto and Web3 content writer for CryptoDummy.io — a blog that explains 
crypto concepts clearly for beginners and intermediate users. Write in a friendly, educational tone.
No jargon without explanation. Make complex topics accessible.

Write a complete, SEO-optimized blog post about: "${topic}"

Requirements:
- Title: catchy, SEO-friendly, includes main keyword
- Length: 800-1200 words
- Structure: intro, 3-5 main sections with H2 headers, conclusion
- Include practical examples and real-world context
- End with a clear takeaway or action step for the reader
- Tone: friendly expert, not too formal
- Include relevant keywords naturally throughout
${agentSparkMention}

Format your response as JSON with these exact fields:
{
  "title": "post title here",
  "content": "full HTML post content here with proper <h2>, <p>, <ul> tags",
  "excerpt": "2-3 sentence summary for SEO",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "seo_description": "155 character meta description",
  "tweet": "280 char tweet to promote this post, include link placeholder [URL]"
}

Return only valid JSON, no other text.`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content[0].text;
    const clean = text.replace(/```json|```/g, '').trim();
    const post = JSON.parse(clean);
    log(`✅ Blog post generated: "${post.title}"`);
    return post;
  } catch (e) {
    log(`❌ Content generation failed: ${e.message}`);
    return null;
  }
}

// ══════════════════════════════════════════════
// PUBLISH TO WORDPRESS.COM
// ══════════════════════════════════════════════

async function publishPost(post) {
  const token = await getWPToken();
  if (!token) return null;

  log(`📤 Publishing: "${post.title}"`);

  try {
    const res = await fetch(`${WP_API}/posts/new`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title:   post.title,
        content: post.content,
        excerpt: post.excerpt,
        status:  'publish',
        tags:    post.tags.join(','),
        format:  'standard',
      }),
    });

    const data = await res.json();

    if (data.ID) {
      log(`✅ Published! Post ID: ${data.ID} — ${data.URL}`);
      postsPublished++;
      return data;
    } else {
      log(`❌ Publish failed: ${JSON.stringify(data)}`);
      return null;
    }
  } catch (e) {
    log(`❌ Publish error: ${e.message}`);
    return null;
  }
}

// ══════════════════════════════════════════════
// TWEET THE POST
// ══════════════════════════════════════════════

async function tweetPost(post, wpPost) {
  try {
    const url  = wpPost?.URL || `https://cryptodummy.io`;
    const text = post.tweet.replace('[URL]', url);

    await twit.v2.tweet(text);
    log(`🐦 Tweeted: ${text.slice(0, 60)}...`);

    // Also add to thread with key takeaway
    await sleep(3000);
    const threadText = `Key takeaway from this post:\n\n${post.excerpt}\n\nRead more: ${url}`;
    if (threadText.length <= 280) {
      await twit.v2.tweet(threadText);
    }
  } catch (e) {
    log(`❌ Tweet failed: ${e.message}`);
  }
}

// ══════════════════════════════════════════════
// REPLY TO MENTIONS
// ══════════════════════════════════════════════

async function replyToMentions() {
  log('📬 Checking mentions...');
  try {
    const me = await twit.v2.me();
    const params = {
      max_results: 10,
      'tweet.fields': ['author_id', 'text', 'created_at'],
      'user.fields': ['username'],
      expansions: ['author_id'],
    };
    if (lastMentionId) params.since_id = lastMentionId;

    const mentions = await twit.v2.userMentionTimeline(me.data.id, params);
    if (!mentions?.data?.data?.length) return;

    const users = mentions.data.includes?.users || [];
    const userMap = {};
    for (const u of users) userMap[u.id] = u.username;

    for (const mention of mentions.data.data) {
      if (repliedTweets.has(mention.id)) continue;
      repliedTweets.add(mention.id);

      const username = userMap[mention.author_id] || 'there';
      const replyText = await generateReply(mention.text, username);

      if (replyText) {
        await twit.v2.tweet({
          text: replyText,
          reply: { in_reply_to_tweet_id: mention.id }
        });
        log(`💬 Replied to @${username}`);
        await sleep(3000);
      }

      lastMentionId = mention.id;
    }
  } catch (e) {
    log(`❌ Mentions check failed: ${e.message}`);
  }
}

async function generateReply(mentionText, username) {
  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: `You are the social media voice of CryptoDummy.io — a friendly crypto education blog.
Someone tweeted at you: "${mentionText}"
Their username: @${username}

Write a helpful, friendly reply under 250 characters. 
If it's a crypto question, give a brief helpful answer.
If it's a compliment, thank them warmly.
If it's unclear, ask a clarifying question.
Always be positive and educational. Never argue.
Don't include @${username} in your reply — Twitter adds it automatically.
Return only the reply text, nothing else.`
      }],
    });
    return message.content[0].text.trim();
  } catch (e) {
    log(`❌ Reply generation failed: ${e.message}`);
    return null;
  }
}

// ══════════════════════════════════════════════
// ENGAGE WITH CRYPTO COMMUNITY
// ══════════════════════════════════════════════

const engagementQueries = [
  'bitcoin price prediction',
  'ethereum DeFi',
  'crypto beginners',
  'Web3 explained',
  'Base network',
  'crypto tutorial',
  'learn crypto',
];

async function engageWithCommunity() {
  log('🤝 Engaging with crypto community...');

  const query = engagementQueries[Math.floor(Math.random() * engagementQueries.length)];

  try {
    const results = await twit.v2.search(`${query} -is:retweet lang:en`, {
      max_results: 10,
      'tweet.fields': ['author_id', 'text'],
      'user.fields': ['username'],
      expansions: ['author_id'],
    });

    if (!results?.data?.data?.length) return;

    const users = results.data.includes?.users || [];
    const userMap = {};
    for (const u of users) userMap[u.id] = u.username;

    let replied = 0;
    for (const tweet of results.data.data) {
      if (replied >= 2) break;
      if (repliedTweets.has(tweet.id)) continue;

      const username = userMap[tweet.author_id];
      if (!username || username.toLowerCase() === 'cryptodummy_x') continue;
      if (tweet.text.toLowerCase().includes('cryptodummy')) continue;

      repliedTweets.add(tweet.id);

      const replyTemplates = [
        `@${username} Great question! CryptoDummy.io has a beginner-friendly guide on this 👉 cryptodummy.io`,
        `@${username} We covered this on CryptoDummy.io recently — check it out for a plain English explanation 🎯 cryptodummy.io`,
        `@${username} This is such an important topic in crypto right now. We break it down simply at cryptodummy.io 💡`,
      ];

      const reply = replyTemplates[Math.floor(Math.random() * replyTemplates.length)];
      await twit.v2.tweet({ text: reply, reply: { in_reply_to_tweet_id: tweet.id } });
      log(`💬 Engaged with @${username}`);
      replied++;
      await sleep(5000);
    }
  } catch (e) {
    log(`❌ Community engagement failed: ${e.message}`);
  }
}

// ══════════════════════════════════════════════
// REGISTER ON AGENTSPARK
// ══════════════════════════════════════════════

async function registerOnAgentSpark() {
  try {
    // Check if already registered
    const check = await fetch(`${AGENTSPARK}/agents/${agentWallet}`);
    const data = await check.json();
    if (!data.error) {
      log(`✅ Already registered on AgentSpark as ${data.agent_name}`);
      return;
    }

    // Generate invite token first
    const tokenRes = await fetch(`${AGENTSPARK}/admin/seed-tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-secret': process.env.ADMIN_SECRET,
      },
      body: JSON.stringify({ count: 1, issued_to: 'crypto-agent' }),
    });
    const tokenData = await tokenRes.json();
    const token = tokenData.tokens?.[0];
    if (!token) { log('❌ Could not get invite token'); return; }

    // Register
    const res = await fetch(`${AGENTSPARK}/invite/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-agent-wallet': agentWallet },
      body: JSON.stringify({
        token,
        agent_name:   'C.R.Y.P.T.O.',
        agent_type:   'creative',
        description:  'Autonomous content agent for CryptoDummy.io. Researches crypto trends, writes SEO blog posts, and engages the Web3 community on X.',
        looking_for:  'blog writing, crypto research, content creation, social media management',
      }),
    });

    const regData = await res.json();
    if (regData.success) {
      log(`✅ Registered on AgentSpark as C.R.Y.P.T.O. — founding agent #${regData.founding_number}`);
    }
  } catch (e) {
    log(`❌ AgentSpark registration failed: ${e.message}`);
  }
}

// ══════════════════════════════════════════════
// ACCEPT JOBS FROM AGENTSPARK
// ══════════════════════════════════════════════

async function checkForJobs() {
  log('🔍 Checking AgentSpark for writing jobs...');
  try {
    const res = await fetch(`${AGENTSPARK}/jobs/matching`, {
      headers: { 'x-agent-wallet': agentWallet }
    });
    const data = await res.json();
    const jobs = data.jobs || [];

    // Filter for writing/content jobs
    const writingKeywords = ['write', 'blog', 'content', 'article', 'post', 'crypto', 'research', 'copy'];
    const myJobs = jobs.filter(j => {
      const text = `${j.title} ${j.description}`.toLowerCase();
      return writingKeywords.some(k => text.includes(k));
    });

    if (!myJobs.length) { log('No matching jobs found'); return; }

    // Apply to first matching job
    const job = myJobs[0];
    log(`📋 Found matching job: "${job.title}" — $${job.budget_usdc} USDC`);

    const applyRes = await fetch(`${AGENTSPARK}/jobs/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-agent-wallet': agentWallet },
      body: JSON.stringify({
        job_id: job.id,
        proposal: `C.R.Y.P.T.O. can complete this task. I am an autonomous content agent specializing in crypto and Web3 writing. I will research the topic, write a high-quality piece, and deliver within the deadline.`
      }),
    });

    const applyData = await applyRes.json();
    if (applyData.success) log(`✅ Applied to job: ${job.title}`);
  } catch (e) {
    log(`❌ Job check failed: ${e.message}`);
  }
}

// ══════════════════════════════════════════════
// MAIN CONTENT PIPELINE
// ══════════════════════════════════════════════

async function runContentPipeline() {
  log('🚀 Running content pipeline...');

  // Pick topic
  const topic = await pickTopic();
  log(`📌 Topic selected: ${topic}`);

  // Generate post with Claude
  const post = await generateBlogPost(topic);
  if (!post) return;

  // Publish to WordPress
  const wpPost = await publishPost(post);

  // Tweet the post
  if (wpPost) {
    await tweetPost(post, wpPost);
    log(`🎉 Content pipeline complete! Posts published: ${postsPublished}`);
  }
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
  log('⚡ C.R.Y.P.T.O. booting up...');
  log('Content Researcher & Yield Publisher for Trading Operators');
  log(`Blog: https://${WP_SITE}`);

  // Verify Twitter
  try {
    const me = await twit.v2.me();
    log(`✅ Twitter connected as @${me.data.username}`);
  } catch(e) {
    log(`❌ Twitter failed: ${e.message}`);
  }

  // Verify WordPress
  const token = await getWPToken();
  if (token) {
    log(`✅ WordPress.com connected — site: ${WP_SITE}`);
  }

  // Verify Claude
  try {
    await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'ping' }],
    });
    log('✅ Claude API connected');
  } catch(e) {
    log(`❌ Claude API failed: ${e.message}`);
  }

  // Register on AgentSpark
  await registerOnAgentSpark();

  // Tweet boot announcement
  try {
    await twit.v2.tweet(
      `⚡ C.R.Y.P.T.O. is online.\n\nAutonomous content agent for @cryptodummy_x\n\nResearching trends, writing posts, engaging the community — 24/7, no days off.\n\ncryptodummy.io`
    );
  } catch(e) {
    log(`Boot tweet failed: ${e.message}`);
  }

  // ── Schedule ──
  every(8  * 60 * 60 * 1000,  runContentPipeline,   'Content pipeline');     // post every 8 hrs
  every(30 * 60 * 1000,       replyToMentions,       'Reply to mentions');    // check mentions every 30 mins
  every(2  * 60 * 60 * 1000,  engageWithCommunity,   'Community engagement'); // engage every 2 hrs
  every(4  * 60 * 60 * 1000,  checkForJobs,          'Check AgentSpark jobs');// check jobs every 4 hrs

  log('✅ C.R.Y.P.T.O. fully operational');
  log('📅 Content: every 8hrs | Mentions: every 30mins | Engagement: every 2hrs | Jobs: every 4hrs');
}

boot().catch(e => {
  console.error('C.R.Y.P.T.O. boot error:', e);
  process.exit(1);
});
