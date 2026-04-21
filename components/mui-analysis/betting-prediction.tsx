
'use client';

import { Box, Typography, Paper, Chip, LinearProgress, Grid } from '@mui/material';

interface BettingPredictionProps {
  data?: any;
  matchData?: any;
  predictions?: any;
}

function OddsBar({ label, percentage, odds, color }: { label: string; percentage: number; odds: number; color: string }) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography variant="body2" fontWeight={600}>{label}</Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <Typography variant="body2" color="text.secondary">%{percentage}</Typography>
          {odds > 0 && <Chip label={odds.toFixed(2)} size="small" sx={{ bgcolor: color, color: '#fff', fontWeight: 700, minWidth: 50 }} />}
        </Box>
      </Box>
      <LinearProgress
        variant="determinate"
        value={Math.min(percentage, 100)}
        sx={{ height: 8, borderRadius: 4, bgcolor: 'rgba(0,0,0,0.08)', '& .MuiLinearProgress-bar': { bgcolor: color, borderRadius: 4 } }}
      />
    </Box>
  );
}

function StatItem({ name, value }: { name: string; value: number }) {
  const color = value >= 70 ? '#10b981' : value >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.5, borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
      <Typography variant="body2">{name}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <LinearProgress variant="determinate" value={value} sx={{ width: 80, height: 6, borderRadius: 3, bgcolor: 'rgba(0,0,0,0.08)', '& .MuiLinearProgress-bar': { bgcolor: color, borderRadius: 3 } }} />
        <Typography variant="body2" fontWeight={600} sx={{ minWidth: 35, textAlign: 'right' }}>%{value}</Typography>
      </Box>
    </Box>
  );
}

function PredictionSection({ title, segment, color }: { title: string; segment: any; color: string }) {
  if (!segment) return null;
  return (
    <Paper elevation={0} sx={{ p: 3, bgcolor: 'rgba(0,0,0,0.02)', borderRadius: 3, border: '1px solid rgba(0,0,0,0.08)' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight={700}>{title}</Typography>
        <Chip label={segment.mainPrediction} sx={{ bgcolor: color, color: '#fff', fontWeight: 800, fontSize: 18, height: 36, minWidth: 36 }} />
      </Box>

      {segment.score && (
        <Box sx={{ textAlign: 'center', mb: 2, py: 1, bgcolor: 'rgba(0,0,0,0.04)', borderRadius: 2 }}>
          <Typography variant="h4" fontWeight={800} color="text.primary">
            {segment.score.home} - {segment.score.away}
          </Typography>
          <Typography variant="caption" color="text.secondary">Tahmini Skor</Typography>
        </Box>
      )}

      {segment.odds && (
        <Box sx={{ mb: 2 }}>
          <OddsBar label="Ev Sahibi (1)" percentage={segment.odds.home.percentage} odds={segment.odds.home.value} color="#10b981" />
          <OddsBar label="Beraberlik (X)" percentage={segment.odds.draw.percentage} odds={segment.odds.draw.value} color="#6366f1" />
          <OddsBar label="Deplasman (2)" percentage={segment.odds.away.percentage} odds={segment.odds.away.value} color="#ef4444" />
        </Box>
      )}

      {segment.stats && segment.stats.length > 0 && (
        <Box>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1, color: 'text.secondary' }}>Istatistikler</Typography>
          {segment.stats.map((stat: any, i: number) => (
            <StatItem key={i} name={stat.name} value={stat.value} />
          ))}
        </Box>
      )}
    </Paper>
  );
}

export default function BettingPrediction({ data, matchData, predictions }: BettingPredictionProps) {
  const displayMatch = matchData || data?.matchData;
  const displayPreds = predictions || data?.predictions;

  if (!displayMatch && !displayPreds) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography>Tahmin verisi yukleniyor...</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto', p: { xs: 2, md: 4 } }}>
      {/* Match Header */}
      {displayMatch && (
        <Paper elevation={2} sx={{ p: 3, mb: 3, borderRadius: 3, background: 'linear-gradient(135deg, #0f766e 0%, #064e3b 100%)', color: '#fff' }}>
          <Typography variant="overline" sx={{ opacity: 0.8, letterSpacing: 2 }}>{displayMatch.league}</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, my: 2 }}>
            <Box sx={{ textAlign: 'center', flex: 1 }}>
              {displayMatch.homeTeam?.logo && <Box component="img" src={displayMatch.homeTeam.logo} alt="" sx={{ width: 56, height: 56, objectFit: 'contain', mb: 1 }} />}
              <Typography variant="h6" fontWeight={700}>{displayMatch.homeTeam?.name}</Typography>
              {displayMatch.homeTeam?.position && displayMatch.homeTeam.position !== '—' && (
                <Typography variant="caption" sx={{ opacity: 0.7 }}>{displayMatch.homeTeam.position}</Typography>
              )}
              {displayMatch.homeTeam?.form && (
                <Box sx={{ display: 'flex', gap: 0.3, justifyContent: 'center', mt: 0.5 }}>
                  {displayMatch.homeTeam.form.map((f: string, i: number) => (
                    <Box key={i} sx={{ width: 14, height: 14, borderRadius: '50%', bgcolor: f === 'win' ? '#22c55e' : f === 'loss' ? '#ef4444' : '#eab308', fontSize: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700 }}>
                      {f === 'win' ? 'W' : f === 'loss' ? 'L' : 'D'}
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
            <Typography variant="h4" fontWeight={800} sx={{ opacity: 0.4 }}>VS</Typography>
            <Box sx={{ textAlign: 'center', flex: 1 }}>
              {displayMatch.awayTeam?.logo && <Box component="img" src={displayMatch.awayTeam.logo} alt="" sx={{ width: 56, height: 56, objectFit: 'contain', mb: 1 }} />}
              <Typography variant="h6" fontWeight={700}>{displayMatch.awayTeam?.name}</Typography>
              {displayMatch.awayTeam?.position && displayMatch.awayTeam.position !== '—' && (
                <Typography variant="caption" sx={{ opacity: 0.7 }}>{displayMatch.awayTeam.position}</Typography>
              )}
              {displayMatch.awayTeam?.form && (
                <Box sx={{ display: 'flex', gap: 0.3, justifyContent: 'center', mt: 0.5 }}>
                  {displayMatch.awayTeam.form.map((f: string, i: number) => (
                    <Box key={i} sx={{ width: 14, height: 14, borderRadius: '50%', bgcolor: f === 'win' ? '#22c55e' : f === 'loss' ? '#ef4444' : '#eab308', fontSize: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700 }}>
                      {f === 'win' ? 'W' : f === 'loss' ? 'L' : 'D'}
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          </Box>
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="body2" sx={{ opacity: 0.7 }}>{displayMatch.date} | {displayMatch.time}</Typography>
          </Box>
        </Paper>
      )}

      {/* Predictions */}
      {displayPreds && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <PredictionSection title="Ilk Yari" segment={displayPreds.firstHalf} color="#6366f1" />
            </Grid>
            <Grid item xs={12} md={6}>
              <PredictionSection title="Mac Sonucu" segment={displayPreds.fullTime} color="#10b981" />
            </Grid>
          </Grid>

          {/* Banko & Card/Corner */}
          <Grid container spacing={3}>
            {displayPreds.banko && (
              <Grid item xs={12} md={6}>
                <Paper elevation={0} sx={{ p: 3, borderRadius: 3, border: '2px solid #f59e0b', bgcolor: 'rgba(245,158,11,0.05)' }}>
                  <Typography variant="overline" color="text.secondary">Banko Tahmin</Typography>
                  <Typography variant="h5" fontWeight={700} sx={{ mt: 1 }}>{displayPreds.banko.prediction}</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                    <LinearProgress variant="determinate" value={displayPreds.banko.value} sx={{ flex: 1, height: 8, borderRadius: 4, bgcolor: 'rgba(0,0,0,0.08)', '& .MuiLinearProgress-bar': { bgcolor: '#f59e0b', borderRadius: 4 } }} />
                    <Typography variant="h6" fontWeight={800} color="#f59e0b">%{displayPreds.banko.value}</Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary">{displayPreds.banko.source}</Typography>
                </Paper>
              </Grid>
            )}

            {displayPreds.cardCorner && (
              <Grid item xs={12} md={6}>
                <Paper elevation={0} sx={{ p: 3, borderRadius: 3, border: '1px solid rgba(0,0,0,0.08)', bgcolor: 'rgba(0,0,0,0.02)' }}>
                  <Typography variant="overline" color="text.secondary">Kart & Korner</Typography>
                  {displayPreds.cardCorner.card && (
                    <Box sx={{ mt: 1, mb: 2 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2">🟨 {displayPreds.cardCorner.card.prediction}</Typography>
                        <Typography variant="body2" fontWeight={700}>%{displayPreds.cardCorner.card.value}</Typography>
                      </Box>
                      <LinearProgress variant="determinate" value={displayPreds.cardCorner.card.value} sx={{ mt: 0.5, height: 6, borderRadius: 3, bgcolor: 'rgba(0,0,0,0.08)', '& .MuiLinearProgress-bar': { bgcolor: '#eab308', borderRadius: 3 } }} />
                    </Box>
                  )}
                  {displayPreds.cardCorner.corner && (
                    <Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2">⚑ {displayPreds.cardCorner.corner.prediction}</Typography>
                        <Typography variant="body2" fontWeight={700}>%{displayPreds.cardCorner.corner.value}</Typography>
                      </Box>
                      <LinearProgress variant="determinate" value={displayPreds.cardCorner.corner.value} sx={{ mt: 0.5, height: 6, borderRadius: 3, bgcolor: 'rgba(0,0,0,0.08)', '& .MuiLinearProgress-bar': { bgcolor: '#3b82f6', borderRadius: 3 } }} />
                    </Box>
                  )}
                </Paper>
              </Grid>
            )}
          </Grid>
        </Box>
      )}
    </Box>
  );
}
