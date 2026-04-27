import { getJobById, openDatabase, saveOutreachDraft } from "../state/db.js";
import { loadProfile } from "../normalization/profile.js";

export function draftOutreach(baseDir: string, jobId: number): string {
  const { db } = openDatabase(baseDir);
  const job = getJobById(db, jobId);
  if (!job) {
    throw new Error(`Job ${jobId} was not found.`);
  }

  const { profile } = loadProfile(baseDir);
  const relevant = job.relevant_projects
    ? job.relevant_projects.split(",").map((entry) => entry.trim()).filter(Boolean)
    : profile.toolSignals.slice(0, 3);
  const draft = job.language === "tr"
    ? [
        `Merhaba ${job.company_name} ekibi,`,
        "",
        `${job.title} pozisyonunu gördüm ve profilimle güçlü bir eşleşme buldum.`,
        `Öne çıkan sinyaller: ${relevant.join(", ") || "ürün geliştirme, tasarım, AI araçları"}.`,
        `Önerilen yaklaşım: ${job.pitch_angle || "Ürün sezgisi ile uygulama hızını birleştirebildiğim noktalarda hızlı katkı sağlayabilirim."}`,
        `Kısa özet: ${job.match_rationale || "Bu rol, tasarım ve AI destekli ürün geliştirme odağımla iyi örtüşüyor."}`,
        "",
        "Uygun görürseniz kısa bir portfolyo paylaşabilir ve nasıl katkı sağlayabileceğimi konuşabiliriz.",
        "",
        "Sevgiler,",
        "[Your Name]",
      ].join("\n")
    : [
        `Hello ${job.company_name} team,`,
        "",
        `I came across the ${job.title} role and found a strong match with my profile.`,
        `The strongest overlap is ${relevant.join(", ") || "product building, design, and AI tooling"}.`,
        `Pitch angle: ${job.pitch_angle || "I can contribute where product judgment and execution speed need to meet."}`,
        `Short rationale: ${job.match_rationale || "This role matches my current focus across design and AI-enabled product work."}`,
        "",
        "If useful, I can share a concise portfolio and discuss how I could contribute quickly.",
        "",
        "Best,",
        "[Your Name]",
      ].join("\n");

  saveOutreachDraft(db, jobId, draft);
  return draft;
}
