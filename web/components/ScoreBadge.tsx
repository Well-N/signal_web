export function ScoreBadge({ score, bilingual = false }: { score?: number | null; bilingual?: boolean }) {
  if (score === null || score === undefined) {
    return <span className="score-badge">{bilingual ? "未评分 / Unrated" : "未评分"}</span>;
  }
  return (
    <span className={score >= 9 ? "score-badge score-badge--high" : "score-badge"}>
      {score.toFixed(1)}
    </span>
  );
}
