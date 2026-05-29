export function parseQuery(raw) {
  const phrases = [];
  let stripped = raw.replace(/"([^"]+)"/g, (_, p) => {
    phrases.push(p.toLowerCase().trim());
    return " ";
  });

  const tokens = stripped.split(/\s+/).filter(Boolean);
  const hasAND = tokens.some(t => t.toUpperCase() === "AND");
  const words = tokens.filter(t => t.toUpperCase() !== "AND");

  const required = hasAND ? words : [];
  const freeTerms = hasAND ? [] : words;

  return { phrases, required, freeTerms, raw };
}
