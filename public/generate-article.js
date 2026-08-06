// functions/generate-article.js
// Cloudflare Pages Function — POST /generate-article
// Body: { "websiteId": "auracoredigital", "contentType": "article" }
//
// Requires an environment variable set in Cloudflare Pages settings:
//   GEMINI_API_KEY = your Gemini API key
// (Set it under Pages project -> Settings -> Environment variables. Do NOT hardcode it here.)

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { websiteId, contentType, focusKeyword, targetAudience } = body;

    if (!websiteId || !contentType) {
      return jsonResponse({ error: "websiteId and contentType are required" }, 400);
    }
    if (!focusKeyword || !focusKeyword.trim()) {
      return jsonResponse({ error: "focusKeyword is required" }, 400);
    }
    if (!targetAudience || !targetAudience.trim()) {
      return jsonResponse({ error: "targetAudience is required" }, 400);
    }

    const origin = new URL(request.url).origin;

    // Load the two config files that live in /config on your Pages site
    const [configRes, platformsRes] = await Promise.all([
      fetch(`${origin}/config/websites-config.json`),
      fetch(`${origin}/config/free-platforms.json`),
    ]);

    if (!configRes.ok || !platformsRes.ok) {
      return jsonResponse({ error: "Could not load config files from /config" }, 500);
    }

    const configData = await configRes.json();
    const platformsData = await platformsRes.json();

    const site = configData.websites.find((w) => w.id === websiteId);
    if (!site) {
      return jsonResponse({ error: `No website found with id "${websiteId}"` }, 404);
    }

    const rules = site.contentTypes[contentType];
    if (!rules) {
      return jsonResponse(
        { error: `No content type "${contentType}" configured for this website` },
        404
      );
    }

    const prompt = buildPrompt(site, contentType, rules, focusKeyword.trim(), targetAudience.trim());

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return jsonResponse({ error: "Gemini API error", detail: errText }, 502);
    }

    const geminiData = await geminiRes.json();
    const articleText =
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "(No content returned)";

    const suggestedPlatforms = platformsData[contentType] || [];

    return jsonResponse({
      website: site.name,
      contentType,
      focusKeyword,
      targetAudience,
      wordCountTarget: rules.wordCount,
      backlink: site.backlink,
      article: articleText,
      suggestedPlatforms,
    });
  } catch (err) {
    return jsonResponse({ error: "Unexpected server error", detail: String(err) }, 500);
  }
}

// Builds the full, final prompt. You never type a prompt in the dashboard —
// this is the ONE place the "master rules" live, combined with the per-site
// config and the two per-article inputs (focus keyword + target audience).
//
// The full SEO rule set (2500-3000 words, keyword density, E-E-A-T, FAQs,
// meta description, tags, slug, etc.) is the master template used for every
// content type. It's automatically SCALED DOWN for short formats (Web 2.0,
// Profile Backlink, Image Submission) where a 2500-word article makes no
// sense — those still get the keyword/backlink/tone rules, just without the
// long-form scaffolding (FAQ, meta description, tags, slug).
function buildPrompt(site, contentType, rules, focusKeyword, targetAudience) {
  const wordCount = rules.wordCount;
  const tier = wordCount >= 1500 ? "FULL" : wordCount >= 300 ? "MEDIUM" : "LIGHT";

  // Keyword frequency scales with length instead of being hardcoded to 30-40,
  // which only makes sense for 2500-3000 word content.
  const minFreq = Math.max(2, Math.round(wordCount / 90));
  const maxFreq = Math.max(minFreq + 2, Math.round(wordCount / 70));

  const base = `
You are a senior SEO content strategist and writer with real subject-matter expertise. You write content that outranks competitors because it is more useful, more specific, and better structured — never because it is stuffed with keywords.

WEBSITE / CLIENT: ${site.name}
NICHE: ${site.niche}
BRAND VOICE: ${site.brandVoice}
SECONDARY KEYWORDS TO WEAVE IN WHERE NATURAL: ${site.targetKeywords.join(", ")}

FOCUS KEYWORD / MAIN KEYPHRASE: "${focusKeyword}"
TARGET AUDIENCE: ${targetAudience}
SEARCH INTENT: Informational

CONTENT TYPE: ${contentType}
TARGET LENGTH: approximately ${wordCount} words
TONE: ${rules.tone}
STRUCTURE GUIDANCE: ${rules.structure}
EXTRA RULES FOR THIS CONTENT TYPE: ${rules.extraRules}

BACKLINK TO INCLUDE:
- URL: ${site.backlink.url}
- Anchor text: "${site.backlink.anchorText}"
- Placement rule: ${site.backlink.placementRule}
- Format it as: [${site.backlink.anchorText}](${site.backlink.url})
`.trim();

  const fullTierRules = `
CONTENT REQUIREMENTS:
- ${wordCount} words, fully detailed and in-depth — genuinely better and more useful than typical competing articles on this topic.
- Use semantic SEO: work in LSI keywords, synonyms, and related terms around "${focusKeyword}" naturally throughout, not just the exact phrase repeated.

TITLE & META:
- Write a clickbait-style but credible title that STARTS with the full focus keyphrase "${focusKeyword}", and includes a power word, a number, and a clear positive or negative sentiment.
- Write a meta description of EXACTLY 15 words, including the focus keyword naturally, written to be intriguing.
- Provide an SEO-friendly URL slug (lowercase, hyphenated).

INTRODUCTION:
- First paragraph must include the focus keyword naturally, hook the reader immediately, and clearly match informational search intent.

STRUCTURE & FORMATTING:
- One main title, multiple structured sections underneath — do NOT literally write the words "H2" or "H3" anywhere, just write clear section titles as part of the flow.
- Paragraph-based writing, not bullet-heavy. Keep paragraphs short — 2 to 4 lines each.
- Bold key phrases for emphasis where it aids skimmability, without overdoing it.

KEYWORD STRATEGY:
- Use the focus keyword "${focusKeyword}" naturally between ${minFreq} and ${maxFreq} times across the piece — safe and optimized, never robotic or forced.
- Include it in: the introduction, at least one section heading, multiple points in the body, and the conclusion.
- Mix in long-tail variations, LSI keywords, and natural synonyms so it never feels repetitive.

E-E-A-T (EXPERIENCE, EXPERTISE, AUTHORITY, TRUST):
- Demonstrate real-world experience and expertise through specific, concrete detail — not vague generalities.
- Include ONE expert-style quote, formatted in **bold italics**. Attribute it to a plausible, clearly-labeled role (e.g. "a senior SEO consultant") rather than inventing a named real person or a fake specific study/citation.
- Reference the kind of insight credible research or industry data would support (Google Scholar-style thinking) without fabricating specific fake statistics, study names, or sources.
- Include at least one short example or mini case study to ground the advice in reality.

READABILITY:
- Conversational but professional tone throughout. Strong narrative flow, not a disconnected list of facts.

FAQ SECTION:
- Add a dedicated FAQ section with 4-6 questions based on real informational search intent for "${focusKeyword}" — the kind of questions people actually type into Google.

CONCLUSION:
- Summarize the key points and close with a subtle, non-pushy call to action.

SEO ADDITIONS (output these AFTER the article body, clearly labeled):
- Suggested category (one word or short phrase)
- 3 tags, comma-separated
- 2-3 suggested image ALT text options related to "${focusKeyword}"
`.trim();

  const mediumTierRules = `
CONTENT REQUIREMENTS:
- Around ${wordCount} words, detailed and genuinely useful, written in the same quality bar as a long-form article, just shorter.
- Weave in the focus keyword "${focusKeyword}" naturally, plus 1-2 natural synonyms/variations. Do not force an exact repeat count — let it read naturally, using it roughly ${minFreq}-${maxFreq} times.
- Include the focus keyword in the opening and in the closing.

TITLE:
- Write a short, compelling title that includes the focus keyword naturally.

STRUCTURE & FORMATTING:
- Paragraph-based writing, short paragraphs (2-4 lines). Do not literally write "H2"/"H3". Bold key phrases sparingly for emphasis.
- Conversational, credible tone — show real expertise/experience in the specific details used, not generic statements.

SEO ADDITIONS (output AFTER the body, clearly labeled):
- Suggested category
- 3 tags, comma-separated
`.trim();

  const lightTierRules = `
CONTENT REQUIREMENTS:
- Keep it to approximately ${wordCount} words — this is a short-format piece, do not pad it.
- Include the focus keyword "${focusKeyword}" naturally once or twice — never forced or stuffed.
- Write it to genuinely read like real, human, purpose-built content for this specific format (not a shortened article).
`.trim();

  const tierRules = tier === "FULL" ? fullTierRules : tier === "MEDIUM" ? mediumTierRules : lightTierRules;

  const closing = `
STRICT RULES:
1. Write 100% original content — no generic filler like "in today's digital age" or "in conclusion" used as a crutch.
2. Follow the STRUCTURE GUIDANCE and EXTRA RULES for this specific content type exactly.
3. Include the backlink exactly once, following the placement rule.
4. Never mention that you are an AI or that this was generated.
5. Output ONLY the finished content in the labeled sections described above — no preamble, no notes, no meta-commentary before or after.

Now write it.
`.trim();

  return `${base}\n\n${tierRules}\n\n${closing}`;
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
