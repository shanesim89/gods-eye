import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export async function POST(request) {
  const { rawThoughts } = await request.json();

  if (!rawThoughts || !rawThoughts.trim()) {
    return Response.json({ error: "rawThoughts is required" }, { status: 400 });
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // ---------- step 1: brief ----------
  const briefPrompt = `You are writing an infographic brief for a Singapore financial advisor named Shane, brand "SHANE boss". His voice: direct, contrarian, slightly cheeky. Audience: busy working adults.

Tone: give it a SLIGHT Singaporean flavour — natural, not caricatured. Light local texture is welcome once in a while (a "lah"/"one"/"sia", or a grounded local reference like hawker centre, HDB, COE, MRT, CPF, NS, kopi money) but most sentences should read as plain direct English. Never force it into every line.

First, extract the core topic/subject from the RAW_THOUGHTS below. Then create an infographic brief for that topic, include visual suggestions. All in words — plain prose, no JSON, no markdown fences.

The brief should cover: the topic in one line, the situation (2-3 sentences, no jargon), how it concretely affects a working adult in Singapore (2-3 sentences), and a few visual suggestions (simple diagrams, icons, or callouts a hand could sketch on a whiteboard to illustrate it).

RAW_THOUGHTS:
${rawThoughts}`;

  const briefMessage = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    messages: [{ role: "user", content: briefPrompt }],
  });

  const brief = briefMessage.content[0].text.trim();
  const topic = rawThoughts.trim().split(/\n/)[0].slice(0, 80);

  // ---------- step 2: whiteboard-photo image ----------
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const imagePrompt = `Generate a single image of a physical, hand-drawn infographic on a large whiteboard or notebook page.
Crucial Style Instructions (Read First):
Medium: The image must look like a photograph of a real whiteboard or large paper notepad.
Texture: All elements must look created by hand using colored marker pens (black, blue, red, green) and highlighters (yellow/orange). Lines should be slightly imperfect, wobbly, and have the texture of ink on a surface.
No Digital Fonts: All text, headings, and bullet points must appear handwritten or hand-printed in marker pen.
Spelling: every single word must be spelled correctly, standard English, no typos, no duplicated or dropped letters, no garbled or invented words. Proofread every line before rendering it. If a word can't be rendered legibly and correctly, simplify to a shorter correctly-spelled word instead.
Layout: Structure the 1080x1350 image as follows:
- A large handwritten headline at the top: "${topic}"
- Below it, sketch out the brief as handwritten sections with supporting doodles/diagrams per the visual suggestions:
${brief}
Use multi-colored markers for emphasis. Keep text large and legible. Make everything look hand-drawn with slight imperfections. Make it look like a photograph of an actual notebook page.
Final check: re-read every word of text in the image and confirm correct spelling before finishing.`;

  const imageResponse = await openai.images.generate({
    model: "gpt-image-1",
    prompt: imagePrompt,
    size: "1024x1536",
    n: 1,
  });

  const b64 = imageResponse.data[0].b64_json;

  return Response.json({ image: `data:image/png;base64,${b64}` });
}
