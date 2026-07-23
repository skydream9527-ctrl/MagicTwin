export function normQuestions(raw) {
  const one = (id, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return {
        id: v.id || id,
        text: v.text || v.q || v.question || v.desc || v.title || "",
        options: Array.isArray(v.options) ? v.options : [],
        recommendation: v.recommendation ?? v.default_suggestion ?? v.default ?? v.suggestion ?? "",
        risk: v.risk || v.level || "low",
      };
    }
    return { id, text: String(v ?? ""), options: [], recommendation: "", risk: "low" };
  };
  if (Array.isArray(raw)) return raw.map((v, i) => one(v && v.id ? v.id : `q${i + 1}`, v));
  if (raw && typeof raw === "object") return Object.entries(raw).map(([k, v]) => one(k, v));
  if (raw !== undefined && raw !== null && raw !== "") return [one("q1", raw)];
  return [];
}

export function questionsToText(raw, sep = "；") {
  return normQuestions(raw).map((q) => q.text).filter(Boolean).join(sep);
}

export function answersToText(raw, sep = "；") {
  if (Array.isArray(raw)) return raw.map((a) => (a && typeof a === "object" ? a.answer || a.text || "" : String(a ?? ""))).filter(Boolean).join(sep);
  if (raw && typeof raw === "object") return Object.values(raw).map((a) => (a && typeof a === "object" ? a.answer || a.text || "" : String(a ?? ""))).filter(Boolean).join(sep);
  return raw ? String(raw) : "";
}
