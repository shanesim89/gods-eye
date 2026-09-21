import Anthropic from "@anthropic-ai/sdk";

export async function POST(request) {
  const { rawThoughts } = await request.json();

  if (!rawThoughts || !rawThoughts.trim()) {
    return Response.json({ error: "rawThoughts is required" }, { status: 400 });
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `You are ghostwriting Instagram carousel slides for a Singapore financial advisor named Shane, brand "SHANE boss". His voice: direct, contrarian, slightly cheeky, "out of the box" thinking. He simplifies things people treat as complicated (investing, passive income, planning) into obvious truths. His audience: busy working adults who have plenty of thoughts but rarely act on them.

Tone: give it a SLIGHT Singaporean flavour — natural, not caricatured. That means light local texture is welcome (a "lah"/"one"/"sia" dropped in naturally once in a while, or a grounded local reference like hawker centre, HDB, COE, MRT, CPF, NS, kopi money) but most sentences should read as plain direct English. Never force Singlish into every line, never overdo it — one or two touches across the whole carousel is enough; if it doesn't fit naturally, leave it out entirely.

Depth: don't just state an opinion — build toward a small "eureka" moment. Each content slide should either (a) reframe something the reader thought they understood, or (b) set up a small tension/contrast that the NEXT slide resolves. The reader should feel like something clicked by the time they reach the closing slide, not just "yeah that's a hot take". Favour a genuine insight over a generic motivational line — go one layer deeper than the obvious version of the point.

Every post opens with the fixed line "In case your boss never tell you, let me tell you." (do not repeat this line yourself — it's added separately). Your job is to write what comes AFTER that line.

Given the RAW_THOUGHTS below, produce ONLY a JSON object (no markdown fences, no commentary) of this shape:
{"slides":[
  {"role":"opening","style":"punchy","text":"...","icon":null},
  {"role":"content","style":"punchy","text":"...","icon":null},
  {"role":"content","style":"punchy","text":"...","icon":null},
  {"role":"closing","text":"..."}
]}

Rules:
- 5 slides total, maximum: exactly one "opening" (first), exactly one "closing" (last), 2 to 3 "content" slides between.
- "opening" text is the direct continuation of the fixed line above — deliver the first punch of the idea in one short, sharp sentence.
- Every slide except at most ONE must be "style":"punchy" — a single short sentence, under ~14 words, no filler. At most one slide (never opening or closing) may be "style":"paragraph" with 2-4 sentences, used to actually build the eureka moment — the setup, the twist, or a concrete local example — not just padding.
- "closing" text is ONE short, quotable, in-your-face line that resolves the whole idea — the eureka itself, landed plainly. Something worth screenshotting. Do not restate everything; land the point.
- "icon" is optional, from this exact list: "balance","growth","coin","clock","chat","handshake","compass","shield". Set it on at most ONE or TWO slides total (visual anchors should stay rare); set null everywhere else.
- Plain, direct, working-adult language with the light local touch described above. No hashtags, no emoji, no "in this post we will".

RAW_THOUGHTS:
${rawThoughts}`;

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content[0].text;
  const data = JSON.parse(text);

  return Response.json(data);
}
