/**
 * Standings Page - Puan Durumu / Tabeller / Standings
 * Arctic Futurism Theme - i18n destekli
 */
import { useState, useEffect } from "react";
import {
  getStandings,
  type Standing,
  type StandingGroup,
} from "@/lib/api";
import { calculateEloFromStandings, type EloRating } from "@/lib/analysis";
import { useLocale } from "@/contexts/LocaleContext";
import { Loader2, Trophy, TrendingUp, TrendingDown, Minus } from "lucide-react";

const MATCH_BG = "https://d2xsxph8kpxj0f.cloudfront.net/113104593/XD6sTiRUS9vW5Ribu2FZ4U/match-card-bg-YDG7fW3iYxrAAMo8F8WvQx.webp";

const POPULAR_LEAGUES = [
  { id: 57, name: "NHL", country: "USA" },
  { id: 55, name: "KHL", country: "Russia" },
  { id: 56, name: "SHL", country: "Sweden" },
  { id: 53, name: "Liiga", country: "Finland" },
  { id: 52, name: "Czech Extraliga", country: "Czech Republic" },
  { id: 4, name: "WHL", country: "Canada" },
  { id: 58, name: "AHL", country: "USA" },
];

export default function Standings() {
  const { t } = useLocale();
  const [selectedLeague, setSelectedLeague] = useState(57);
  const [selectedSeason, setSelectedSeason] = useState(2025);
  const [standings, setStandings] = useState<StandingGroup[]>([]);
  const [eloRatings, setEloRatings] = useState<EloRating[]>([]);
  const [loading, setLoading] = useState(true);
  const [showElo, setShowElo] = useState(false);

  useEffect(() => {
    const fetchStandings = async () => {
      setLoading(true);
      try {
        const res = await getStandings({ league: selectedLeague, season: selectedSeason });
        const data = res.response || [];
        setStandings(data);
        const allStandings = data.flat();
        if (allStandings.length > 0) {
          setEloRatings(calculateEloFromStandings(allStandings));
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchStandings();
  }, [selectedLeague, selectedSeason]);

  const eloSubtitle = { tr: 'Lig sıralamaları ve ELO güç derecelendirmesi', sv: 'Ligatabeller och ELO-styrkeranking', en: 'League standings and ELO power rankings' };
  const eloLabel = { tr: 'ELO Güç Sıralaması', sv: 'ELO Styrkeranking', en: 'ELO Power Rankings' };

  return (
    <div className="space-y-6">
      <div
        className="relative rounded-xl overflow-hidden h-32"
        style={{ backgroundImage: `url(${MATCH_BG})`, backgroundSize: "cover", backgroundPosition: "center" }}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-background/90 via-background/70 to-transparent" />
        <div className="relative z-10 h-full flex flex-col justify-center px-6">
          <h1 className="font-display text-2xl font-bold tracking-wider neon-text">{t('standings_title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{eloSubtitle[useLocale().locale]}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {POPULAR_LEAGUES.map((l) => (
          <button
            key={l.id}
            onClick={() => setSelectedLeague(l.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              selectedLeague === l.id ? "glass-card neon-border text-ice" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
            }`}
          >
            {l.name}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setShowElo(false)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${!showElo ? "glass-card neon-border text-ice" : "text-muted-foreground hover:bg-accent/50"}`}
        >
          <Trophy className="w-3.5 h-3.5 inline mr-1.5" />
          {t('standings_title')}
        </button>
        <button
          onClick={() => setShowElo(true)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${showElo ? "glass-card neon-border text-ice" : "text-muted-foreground hover:bg-accent/50"}`}
        >
          <TrendingUp className="w-3.5 h-3.5 inline mr-1.5" />
          {eloLabel[useLocale().locale]}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-ice" />
        </div>
      ) : showElo ? (
        <EloTable ratings={eloRatings} />
      ) : (
        <StandingsTable groups={standings} />
      )}
    </div>
  );
}

function StandingsTable({ groups }: { groups: StandingGroup[] }) {
  const { t } = useLocale();

  if (groups.length === 0) {
    return (
      <div className="glass-card rounded-xl p-8 text-center">
        <p className="text-muted-foreground">{t('standings_no_data')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {groups.map((group, gi) => {
        const groupName = group[0]?.group?.name || `Group ${gi + 1}`;
        return (
          <div key={gi} className="glass-card rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-accent/20">
              <h3 className="text-sm font-semibold">{groupName}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b border-border">
                    <th className="text-left py-2 px-3 w-8">{t('standings_pos')}</th>
                    <th className="text-left py-2 px-2">{t('standings_team')}</th>
                    <th className="text-center py-2 px-2">{t('standings_played')}</th>
                    <th className="text-center py-2 px-2">{t('standings_won_short')}</th>
                    <th className="text-center py-2 px-2">{t('standings_lost_short')}</th>
                    <th className="text-center py-2 px-2">OTW</th>
                    <th className="text-center py-2 px-2">OTL</th>
                    <th className="text-center py-2 px-2">{t('standings_goals_for')}</th>
                    <th className="text-center py-2 px-2">{t('standings_goals_against')}</th>
                    <th className="text-center py-2 px-2">+/-</th>
                    <th className="text-center py-2 px-2 font-bold">{t('standings_points')}</th>
                    <th className="text-center py-2 px-2">{t('standings_form')}</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {group.map((s) => {
                    const gd = s.goals.for - s.goals.against;
                    return (
                      <tr key={s.team.id} className="border-b border-border/20 hover:bg-accent/20 transition-colors">
                        <td className="py-2 px-3 text-muted-foreground">{s.position}</td>
                        <td className="py-2 px-2">
                          <div className="flex items-center gap-2">
                            <img src={s.team.logo} alt="" className="w-4 h-4 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                            <span className="font-medium text-foreground whitespace-nowrap">{s.team.name}</span>
                            {s.description === "Playoffs" && <span className="text-[8px] text-aurora bg-aurora/10 px-1 rounded">PO</span>}
                          </div>
                        </td>
                        <td className="text-center py-2 px-2">{s.games.played}</td>
                        <td className="text-center py-2 px-2 text-aurora">{s.games.win.total}</td>
                        <td className="text-center py-2 px-2 text-destructive">{s.games.lose.total}</td>
                        <td className="text-center py-2 px-2 text-muted-foreground">{s.games.win_overtime?.total ?? "-"}</td>
                        <td className="text-center py-2 px-2 text-muted-foreground">{s.games.lose_overtime?.total ?? "-"}</td>
                        <td className="text-center py-2 px-2">{s.goals.for}</td>
                        <td className="text-center py-2 px-2">{s.goals.against}</td>
                        <td className={`text-center py-2 px-2 ${gd > 0 ? "text-aurora" : gd < 0 ? "text-destructive" : ""}`}>
                          {gd > 0 ? `+${gd}` : gd}
                        </td>
                        <td className="text-center py-2 px-2 font-bold text-ice">{s.points}</td>
                        <td className="text-center py-2 px-2"><FormBadges form={s.form || ""} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EloTable({ ratings }: { ratings: EloRating[] }) {
  const { locale } = useLocale();
  if (ratings.length === 0) return null;

  const eloTitle = { tr: 'ELO Güç Derecelendirmesi', sv: 'ELO Styrkeranking', en: 'ELO Power Rankings' };
  const eloDesc = { tr: 'Kazanma oranı, gol farkı ve puana dayalı hesaplama', sv: 'Baserat på vinstprocent, målskillnad och poäng', en: 'Based on win rate, goal difference and points' };
  const trendLabel = { tr: 'Trend', sv: 'Trend', en: 'Trend' };
  const powerLabel = { tr: 'Güç Barı', sv: 'Styrka', en: 'Power Bar' };

  return (
    <div className="glass-card rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-accent/20">
        <h3 className="text-sm font-semibold">{eloTitle[locale]}</h3>
        <p className="text-[10px] text-muted-foreground mt-0.5">{eloDesc[locale]}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground border-b border-border">
              <th className="text-left py-2 px-3 w-8">#</th>
              <th className="text-left py-2 px-2">{useLocale().t('standings_team')}</th>
              <th className="text-center py-2 px-2">ELO Rating</th>
              <th className="text-center py-2 px-2">{trendLabel[locale]}</th>
              <th className="text-center py-2 px-2">{powerLabel[locale]}</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {ratings.map((r, i) => {
              const maxRating = ratings[0].rating;
              const minRating = ratings[ratings.length - 1].rating;
              const pct = ((r.rating - minRating) / (maxRating - minRating)) * 100;
              return (
                <tr key={r.teamId} className="border-b border-border/20 hover:bg-accent/20 transition-colors">
                  <td className="py-2 px-3 text-muted-foreground">{i + 1}</td>
                  <td className="py-2 px-2 font-medium text-foreground">{r.teamName}</td>
                  <td className="text-center py-2 px-2 font-bold text-ice">{r.rating}</td>
                  <td className="text-center py-2 px-2">
                    {r.trend === "up" && <TrendingUp className="w-3.5 h-3.5 text-aurora inline" />}
                    {r.trend === "down" && <TrendingDown className="w-3.5 h-3.5 text-destructive inline" />}
                    {r.trend === "stable" && <Minus className="w-3.5 h-3.5 text-muted-foreground inline" />}
                  </td>
                  <td className="py-2 px-2 w-32">
                    <div className="h-2 bg-accent rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-ice to-aurora rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FormBadges({ form }: { form: string }) {
  return (
    <div className="flex gap-0.5 justify-center">
      {form.split("").slice(-5).map((f, i) => (
        <span
          key={i}
          className={`w-4 h-4 rounded-sm flex items-center justify-center text-[8px] font-bold ${
            f === "W" ? "bg-aurora/20 text-aurora" : f === "L" ? "bg-destructive/20 text-destructive" : "bg-warning/20 text-warning"
          }`}
        >
          {f}
        </span>
      ))}
    </div>
  );
}
