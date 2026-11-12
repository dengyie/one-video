// Text prompt: stock-search queries per scene, so assets suggest can look for real photos/footage
// in English-language archives (Wikimedia, NASA, Openverse, Pexels) for narration in any language.
export const suggestAssetsPrompt = ({ title, scenes, per }) => `You are picking real photos and footage for a narrated video${title ? ` titled "${title}"` : ""}.
For each scene below, write ${per} short English search queries (2–5 words each) for a free-licensed stock archive such as Wikimedia Commons: name concrete people, places, products, buildings, events or objects that can actually be photographed. No abstract ideas, no quotes, no years alone. Order them from the most specific to the most general.

${scenes.map((s) => `[${s.id}] ${s.text}`).join("\n")}

Reply only JSON {"<scene id>": ["query", …], …} with every scene id above.`;
