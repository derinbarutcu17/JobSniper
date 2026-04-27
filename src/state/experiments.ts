import type Database from "better-sqlite3";

export interface ExperimentSummary {
  replyRateByRoute: Record<string, number>;
  positiveOutcomeRateByRoute: Record<string, number>;
  topPitchThemes: Array<{ pitchTheme: string; count: number }>;
}

export function summarizeExperiments(db: Database.Database): ExperimentSummary {
  const routeRows = db.prepare(`
    SELECT
      COALESCE(j.recommended_route, 'unknown') AS route,
      COUNT(o.id) AS outcomes,
      SUM(CASE WHEN o.result IN ('reply', 'call', 'interview', 'positive_signal') THEN 1 ELSE 0 END) AS replies,
      SUM(CASE WHEN o.result IN ('call', 'interview', 'positive_signal') THEN 1 ELSE 0 END) AS positives
    FROM outcome_log o
    LEFT JOIN jobs j ON j.id = o.job_id
    GROUP BY COALESCE(j.recommended_route, 'unknown')
  `).all() as Array<{ route: string; outcomes: number; replies: number; positives: number }>;

  const themeRows = db.prepare(`
    SELECT pitch_theme, COUNT(*) AS count
    FROM jobs
    WHERE pitch_theme != ''
    GROUP BY pitch_theme
    ORDER BY count DESC
    LIMIT 5
  `).all() as Array<{ pitch_theme: string; count: number }>;

  const replyRateByRoute: Record<string, number> = {};
  const positiveOutcomeRateByRoute: Record<string, number> = {};
  for (const row of routeRows) {
    replyRateByRoute[row.route] = row.outcomes ? row.replies / row.outcomes : 0;
    positiveOutcomeRateByRoute[row.route] = row.outcomes ? row.positives / row.outcomes : 0;
  }

  return {
    replyRateByRoute,
    positiveOutcomeRateByRoute,
    topPitchThemes: themeRows.map((row) => ({ pitchTheme: row.pitch_theme, count: row.count })),
  };
}

