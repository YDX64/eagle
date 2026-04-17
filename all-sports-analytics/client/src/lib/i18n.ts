/**
 * AWA Stats - Internationalization (i18n) System
 * Desteklenen diller: Türkçe (tr), İsveççe (sv), İngilizce (en)
 * Otomatik tarayıcı dili algılama + localStorage kayıt
 */

export type Locale = 'tr' | 'sv' | 'en';

export interface LocaleInfo {
  code: Locale;
  name: string;
  nativeName: string;
  flag: string; // emoji flag
  flagUrl: string; // SVG flag URL
}

export const LOCALES: LocaleInfo[] = [
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', flag: '🇹🇷', flagUrl: 'https://flagcdn.com/w40/tr.png' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska', flag: '🇸🇪', flagUrl: 'https://flagcdn.com/w40/se.png' },
  { code: 'en', name: 'English', nativeName: 'English', flag: '🇬🇧', flagUrl: 'https://flagcdn.com/w40/gb.png' },
];

const STORAGE_KEY = 'awa-stats-locale';

export function detectLocale(): Locale {
  // 1. localStorage'dan kontrol
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && ['tr', 'sv', 'en'].includes(stored)) return stored as Locale;

  // 2. Tarayıcı dilinden algıla
  const browserLang = navigator.language || (navigator as any).userLanguage || '';
  const lang = browserLang.toLowerCase().split('-')[0];
  
  if (lang === 'tr') return 'tr';
  if (lang === 'sv') return 'sv';
  if (lang === 'en') return 'en';
  
  // İskandinav dilleri için İsveççe
  if (['da', 'no', 'nb', 'nn', 'fi'].includes(lang)) return 'sv';
  
  // Varsayılan İngilizce
  return 'en';
}

export function saveLocale(locale: Locale): void {
  localStorage.setItem(STORAGE_KEY, locale);
}

export function getLocaleInfo(locale: Locale): LocaleInfo {
  return LOCALES.find(l => l.code === locale) || LOCALES[2];
}

// ===== ÇEVİRİ SÖZLÜĞÜ =====
type TranslationKeys = typeof translations.tr;

const translations = {
  tr: {
    // Navigation
    nav_daily_matches: 'Günlük Maçlar',
    nav_standings: 'Puan Durumu',
    nav_coupons: 'Kupon Stratejileri',
    nav_coupon_history: 'Kupon Geçmişi',
    nav_system_active: 'Sistem Aktif',

    // Home Page
    home_title: 'GÜNLÜK MAÇLAR',
    home_subtitle: 'Tüm buz hokeyi maçlarını canlı takip edin, gelişmiş analiz ve tahminlere erişin',
    home_live: 'Canlı',
    home_upcoming: 'Başlamadı',
    home_finished: 'Bitti',
    home_all_statuses: 'Tüm Durumlar',
    home_all_leagues: 'Tüm Ligler',
    home_matches: 'maç',
    home_no_matches: 'Seçilen tarih ve filtrelere uygun maç bulunamadı',
    home_last_update: 'Son güncelleme',

    // Match Detail
    match_back: 'Maçlara Dön',
    match_analyzing: 'Analiz yapılıyor...',
    match_not_found: 'Maç bulunamadı',
    match_finished: 'Bitti',
    match_tab_analysis: 'Analiz & Tahmin',
    match_tab_smart_bets: 'Akıllı Bahisler',
    match_tab_value_bets: 'Value Bets',
    match_tab_player_props: 'Oyuncu Tahminleri',
    match_tab_odds: 'Oranlar',
    match_tab_h2h: 'H2H',
    match_tab_events: 'Olaylar',

    // Analysis
    analysis_win_prob: 'KAZANMA OLASILIKLARI',
    analysis_expected_goals: 'BEKLENEN GOLLER',
    analysis_over_under: 'ALT/ÜST OLASILIKLARI',
    analysis_likely_scores: 'EN OLASI SKORLAR',
    analysis_team_stats: 'TAKIM İSTATİSTİKLERİ KARŞILAŞTIRMASI',
    analysis_home: 'Ev Sahibi',
    analysis_away: 'Deplasman',
    analysis_draw: 'Berabere',
    analysis_total: 'Toplam',
    analysis_confidence: 'Güven Skoru',
    analysis_actual_result: 'Gerçek Sonuç',
    analysis_actual: 'Gerçek',
    analysis_btts_yes: 'KG Var',
    analysis_btts_no: 'KG Yok',
    analysis_form_score: 'Form Skoru',

    // Smart Bets
    smart_title: 'AKILLI BAHİS ANALİZİ',
    smart_subtitle: 'Düşük riskli, yüksek değerli bahis fırsatları',
    smart_description: 'Bu sekme, düşük riskli ama yüksek değerli bahisleri tespit eder. Double Chance, Gol Var/Yok, Over/Under gibi güvenli bahis türlerini analiz ederek, bahisçilerin yanlış fiyatladığı fırsatları bulur.',
    smart_low_risk: 'Düşük Riskli',
    smart_high_value: 'Yüksek Değer',
    smart_positive_edge: 'Pozitif Edge',
    smart_all: 'Tümü',
    smart_no_bets: 'Bu filtrede bahis bulunamadı',

    // Value Bets
    value_detected: 'Value Bet Tespit Edildi',
    value_description: 'Edge yüzdesi ne kadar yüksekse, bahsin uzun vadede o kadar karlı olması beklenir.',
    value_no_bets: 'Bu maç için value bet bulunamadı',
    value_true_prob: 'Gerçek Olasılık',
    value_implied_prob: 'Bahisçi Olasılığı',
    value_edge: 'Edge (Avantaj)',
    value_kelly: 'Kelly Oranı',

    // Player Props
    player_title: 'OYUNCU TAHMİNLERİ',
    player_analyzed: 'oyuncu bahisi analiz edildi',
    player_description: 'Oyuncu bazlı bahisler genellikle yüksek oranlar sunar. Gol atma, asist, şut sayısı, puan gibi oyuncu performansına dayalı tahminler.',
    player_all: 'Tümü',
    player_goal: 'Gol',
    player_shot: 'Şut',
    player_point: 'Puan',
    player_assist: 'Asist',
    player_positive_only: 'Sadece Pozitif Edge',
    player_no_predictions: 'Bu filtrede oyuncu tahmini bulunamadı',
    player_estimated: 'Tahmini',
    player_confidence_label: 'Güven',
    player_more: 'daha fazla tahmin mevcut',

    // Odds
    odds_bookmakers: 'bahisçi',
    odds_bet_types: 'bahis türü',
    odds_results_showing: 'Sonuçlar gösteriliyor',
    odds_no_odds: 'Bu maç için oran bilgisi bulunamadı',
    odds_selection: 'Seçenek',
    odds_best_odds: 'En İyi Oran',
    odds_bookmaker: 'Bahisçi',
    odds_avg_odds: 'Ort. Oran',
    odds_result: 'Sonuç',
    odds_options: 'seçenek',

    // H2H
    h2h_title: 'KARŞILIKLI İSTATİSTİKLER',
    h2h_matches: 'maç',
    h2h_home_wins: 'Ev Sahibi Galibiyet',
    h2h_draws: 'Berabere',
    h2h_away_wins: 'Deplasman Galibiyet',
    h2h_avg_goals: 'Ort. Toplam Gol',
    h2h_over25: '2.5 Üst Oranı',
    h2h_btts: 'KG Var Oranı',
    h2h_recent: 'SON MAÇLAR',
    h2h_no_data: 'Karşılıklı maç geçmişi bulunamadı',

    // Events
    events_title: 'MAÇ OLAYLARI',
    events_no_data: 'Maç olayları bulunamadı',
    events_goal: 'GOL',
    events_penalty: 'CEZA',
    events_assist: 'Asist',

    // Risk levels
    risk_very_low: 'Çok Düşük Risk',
    risk_low: 'Düşük Risk',
    risk_medium: 'Orta Risk',
    risk_high: 'Yüksek Risk',

    // Results
    result_won: 'KAZANDI',
    result_lost: 'KAYBETTİ',
    result_void: 'GEÇERSİZ',
    result_pending: 'BEKLENİYOR',

    // Ratings
    rating_excellent: 'Mükemmel',
    rating_good: 'İyi',
    rating_moderate: 'Orta',
    rating_low: 'Düşük',

    // Coupons Page
    coupons_title: 'KUPON STRATEJİLERİ',
    coupons_subtitle: 'AI destekli analiz ile günün en değerli bahisleri',
    coupons_analysis: 'Analiz',
    coupons_value_bet: 'Value Bet',
    coupons_coupon: 'Kupon',
    coupons_recommended: 'ÖNERİLEN KUPONLAR',
    coupons_total_odds: 'toplam oran',
    coupons_expected_prob: 'Beklenen Olasılık',
    coupons_expected_value: 'Beklenen Değer',
    coupons_suggested_stake: 'Önerilen Yatırım',
    coupons_potential_return: 'Potansiyel Kazanç',
    coupons_unit: 'birim',
    coupons_save: 'Kuponu Kaydet',
    coupons_bets: 'bahis',
    coupons_no_strategy: 'Bugün için kupon stratejisi oluşturulamadı',
    coupons_no_strategy_desc: 'Yeterli value bet bulunamadı veya maç sayısı yetersiz',
    coupons_by_game: 'MAÇLARA GÖRE VALUE BETLER',
    coupons_disclaimer_title: 'Sorumluluk Reddi',
    coupons_disclaimer: 'Bu tahminler istatistiksel modellere dayanmaktadır ve kesin sonuç garantisi vermez. Bahis yapmadan önce kendi araştırmanızı yapın. Kaybetmeyi göze alabileceğiniz miktardan fazlasını yatırmayın.',
    coupons_analyzing: 'Analiz Yapılıyor',
    coupons_fetching: 'Günlük maçlar çekiliyor...',
    coupons_creating: 'Kupon stratejileri oluşturuluyor...',
    coupons_score: 'Skor',

    // Coupon History
    history_title: 'KUPON GEÇMİŞİ',
    history_subtitle: 'Kaydedilen kuponların sonuçları ve performans takibi',
    history_no_coupons: 'Henüz kaydedilmiş kupon yok',
    history_no_coupons_desc: 'Kupon Stratejileri sayfasından kupon kaydedebilirsiniz.',
    history_go_coupons: 'Kupon Stratejilerine Git',
    history_all: 'Tümü',
    history_pending: 'Bekleyen',
    history_won: 'Kazanan',
    history_lost: 'Kaybeden',
    history_partial: 'Kısmi',
    history_total_stake: 'Toplam Yatırım',
    history_total_return: 'Toplam Dönüş',
    history_profit: 'Kar/Zarar',
    history_roi: 'ROI',
    history_avg_odds: 'Ort. Oran',
    history_delete: 'Sil',
    history_delete_confirm: 'Bu kuponu silmek istediğinize emin misiniz?',

    // Standings
    standings_title: 'PUAN DURUMU',
    standings_subtitle: 'Tüm liglerin güncel puan tabloları',
    standings_select_league: 'Lig Seçin',
    standings_loading: 'Puan durumu yükleniyor...',
    standings_no_data: 'Bu lig için puan durumu bulunamadı',
    standings_pos: '#',
    standings_team: 'Takım',
    standings_played: 'O',
    standings_won_short: 'G',
    standings_lost_short: 'M',
    standings_goals_for: 'AG',
    standings_goals_against: 'YG',
    standings_points: 'P',
    standings_form: 'Form',

    // Stats labels
    stat_played: 'Oynanan Maç',
    stat_wins: 'Galibiyet',
    stat_losses: 'Mağlubiyet',
    stat_goals_scored: 'Atılan Gol',
    stat_goals_conceded: 'Yenilen Gol',
    stat_goals_avg_scored: 'Gol Ort. (Atılan)',
    stat_goals_avg_conceded: 'Gol Ort. (Yenilen)',
    stat_home_wins: 'Ev Galibiyet',
    stat_win_pct: 'Kazanma %',

    // Common
    common_odds: 'oran',
    common_probability: 'olasılık',
    common_vs: 'vs',
    common_loading: 'Yükleniyor...',
    common_error: 'Hata',
    common_back: 'Geri',
    common_save: 'Kaydet',
    common_delete: 'Sil',
    common_close: 'Kapat',
    common_won: 'Kazandı',
    common_lost: 'Kaybetti',
    common_success: 'başarı',
  },

  sv: {
    nav_daily_matches: 'Dagliga Matcher',
    nav_standings: 'Tabeller',
    nav_coupons: 'Kupongstrategier',
    nav_coupon_history: 'Kuponghistorik',
    nav_system_active: 'System Aktivt',

    home_title: 'DAGLIGA MATCHER',
    home_subtitle: 'Följ alla ishockeymatcher live, få avancerad analys och prognoser',
    home_live: 'Live',
    home_upcoming: 'Kommande',
    home_finished: 'Avslutad',
    home_all_statuses: 'Alla Statusar',
    home_all_leagues: 'Alla Ligor',
    home_matches: 'matcher',
    home_no_matches: 'Inga matcher hittades för valt datum och filter',
    home_last_update: 'Senast uppdaterad',

    match_back: 'Tillbaka till Matcher',
    match_analyzing: 'Analyserar...',
    match_not_found: 'Match hittades inte',
    match_finished: 'Avslutad',
    match_tab_analysis: 'Analys & Prognos',
    match_tab_smart_bets: 'Smarta Spel',
    match_tab_value_bets: 'Value Bets',
    match_tab_player_props: 'Spelarprognoser',
    match_tab_odds: 'Odds',
    match_tab_h2h: 'H2H',
    match_tab_events: 'Händelser',

    analysis_win_prob: 'VINSTSANNOLIKHET',
    analysis_expected_goals: 'FÖRVÄNTADE MÅL',
    analysis_over_under: 'ÖVER/UNDER SANNOLIKHET',
    analysis_likely_scores: 'MEST TROLIGA RESULTAT',
    analysis_team_stats: 'LAGSTATISTIK JÄMFÖRELSE',
    analysis_home: 'Hemmalag',
    analysis_away: 'Bortalag',
    analysis_draw: 'Oavgjort',
    analysis_total: 'Totalt',
    analysis_confidence: 'Konfidenspoäng',
    analysis_actual_result: 'Verkligt Resultat',
    analysis_actual: 'Verkligt',
    analysis_btts_yes: 'Båda Gör Mål',
    analysis_btts_no: 'Inte Båda',
    analysis_form_score: 'Formpoäng',

    smart_title: 'SMART SPELANALYS',
    smart_subtitle: 'Lågrisk, högvärde spelmöjligheter',
    smart_description: 'Denna flik identifierar lågrisk men högvärde spel. Analyserar säkra speltyper som Double Chance, Mål Ja/Nej, Över/Under för att hitta felprissatta möjligheter.',
    smart_low_risk: 'Låg Risk',
    smart_high_value: 'Högt Värde',
    smart_positive_edge: 'Positiv Edge',
    smart_all: 'Alla',
    smart_no_bets: 'Inga spel hittades med detta filter',

    value_detected: 'Value Bets Hittade',
    value_description: 'Ju högre edge-procent, desto mer lönsamt förväntas spelet vara på lång sikt.',
    value_no_bets: 'Inga value bets hittades för denna match',
    value_true_prob: 'Verklig Sannolikhet',
    value_implied_prob: 'Bookmaker Sannolikhet',
    value_edge: 'Edge (Fördel)',
    value_kelly: 'Kelly Andel',

    player_title: 'SPELARPROGNOSER',
    player_analyzed: 'spelarspel analyserade',
    player_description: 'Spelarbaserade spel erbjuder ofta höga odds. Prognoser baserade på målskytte, assist, skott och poäng.',
    player_all: 'Alla',
    player_goal: 'Mål',
    player_shot: 'Skott',
    player_point: 'Poäng',
    player_assist: 'Assist',
    player_positive_only: 'Bara Positiv Edge',
    player_no_predictions: 'Inga spelarprognoser hittades med detta filter',
    player_estimated: 'Uppskattat',
    player_confidence_label: 'Konfidens',
    player_more: 'fler prognoser tillgängliga',

    odds_bookmakers: 'bookmakers',
    odds_bet_types: 'speltyper',
    odds_results_showing: 'Resultat visas',
    odds_no_odds: 'Inga odds hittades för denna match',
    odds_selection: 'Val',
    odds_best_odds: 'Bästa Odds',
    odds_bookmaker: 'Bookmaker',
    odds_avg_odds: 'Snitt Odds',
    odds_result: 'Resultat',
    odds_options: 'alternativ',

    h2h_title: 'INBÖRDES STATISTIK',
    h2h_matches: 'matcher',
    h2h_home_wins: 'Hemmavinster',
    h2h_draws: 'Oavgjorda',
    h2h_away_wins: 'Bortavinster',
    h2h_avg_goals: 'Snitt Totala Mål',
    h2h_over25: 'Över 2.5 Andel',
    h2h_btts: 'Båda Gör Mål Andel',
    h2h_recent: 'SENASTE MATCHER',
    h2h_no_data: 'Ingen inbördes matchhistorik hittades',

    events_title: 'MATCHHÄNDELSER',
    events_no_data: 'Inga matchhändelser hittades',
    events_goal: 'MÅL',
    events_penalty: 'UTVISNING',
    events_assist: 'Assist',

    risk_very_low: 'Mycket Låg Risk',
    risk_low: 'Låg Risk',
    risk_medium: 'Medel Risk',
    risk_high: 'Hög Risk',

    result_won: 'VUNNEN',
    result_lost: 'FÖRLORAD',
    result_void: 'OGILTIG',
    result_pending: 'VÄNTANDE',

    rating_excellent: 'Utmärkt',
    rating_good: 'Bra',
    rating_moderate: 'Medel',
    rating_low: 'Låg',

    coupons_title: 'KUPONGSTRATEGIER',
    coupons_subtitle: 'AI-driven analys för dagens mest värdefulla spel',
    coupons_analysis: 'Analys',
    coupons_value_bet: 'Value Bet',
    coupons_coupon: 'Kupong',
    coupons_recommended: 'REKOMMENDERADE KUPONGER',
    coupons_total_odds: 'totala odds',
    coupons_expected_prob: 'Förväntad Sannolikhet',
    coupons_expected_value: 'Förväntat Värde',
    coupons_suggested_stake: 'Föreslagen Insats',
    coupons_potential_return: 'Potentiell Vinst',
    coupons_unit: 'enhet',
    coupons_save: 'Spara Kupong',
    coupons_bets: 'spel',
    coupons_no_strategy: 'Inga kupongstrategier kunde skapas idag',
    coupons_no_strategy_desc: 'Inte tillräckligt med value bets eller för få matcher',
    coupons_by_game: 'VALUE BETS PER MATCH',
    coupons_disclaimer_title: 'Ansvarsfriskrivning',
    coupons_disclaimer: 'Dessa prognoser baseras på statistiska modeller och garanterar inte resultat. Gör din egen research innan du spelar. Satsa aldrig mer än du har råd att förlora.',
    coupons_analyzing: 'Analyserar',
    coupons_fetching: 'Hämtar dagliga matcher...',
    coupons_creating: 'Skapar kupongstrategier...',
    coupons_score: 'Resultat',

    history_title: 'KUPONGHISTORIK',
    history_subtitle: 'Resultat och prestandaövervakning för sparade kuponger',
    history_no_coupons: 'Inga sparade kuponger ännu',
    history_no_coupons_desc: 'Du kan spara kuponger från Kupongstrategier-sidan.',
    history_go_coupons: 'Gå till Kupongstrategier',
    history_all: 'Alla',
    history_pending: 'Väntande',
    history_won: 'Vunna',
    history_lost: 'Förlorade',
    history_partial: 'Delvis',
    history_total_stake: 'Total Insats',
    history_total_return: 'Total Återbetalning',
    history_profit: 'Vinst/Förlust',
    history_roi: 'ROI',
    history_avg_odds: 'Snitt Odds',
    history_delete: 'Radera',
    history_delete_confirm: 'Är du säker på att du vill radera denna kupong?',

    standings_title: 'TABELLER',
    standings_subtitle: 'Aktuella tabeller för alla ligor',
    standings_select_league: 'Välj Liga',
    standings_loading: 'Laddar tabeller...',
    standings_no_data: 'Ingen tabell hittades för denna liga',
    standings_pos: '#',
    standings_team: 'Lag',
    standings_played: 'S',
    standings_won_short: 'V',
    standings_lost_short: 'F',
    standings_goals_for: 'GM',
    standings_goals_against: 'IM',
    standings_points: 'P',
    standings_form: 'Form',

    stat_played: 'Spelade Matcher',
    stat_wins: 'Vinster',
    stat_losses: 'Förluster',
    stat_goals_scored: 'Gjorda Mål',
    stat_goals_conceded: 'Insläppta Mål',
    stat_goals_avg_scored: 'Målsnitt (Gjorda)',
    stat_goals_avg_conceded: 'Målsnitt (Insläppta)',
    stat_home_wins: 'Hemmavinster',
    stat_win_pct: 'Vinstprocent',

    common_odds: 'odds',
    common_probability: 'sannolikhet',
    common_vs: 'vs',
    common_loading: 'Laddar...',
    common_error: 'Fel',
    common_back: 'Tillbaka',
    common_save: 'Spara',
    common_delete: 'Radera',
    common_close: 'Stäng',
    common_won: 'Vunnen',
    common_lost: 'Förlorad',
    common_success: 'framgång',
  },

  en: {
    nav_daily_matches: 'Daily Matches',
    nav_standings: 'Standings',
    nav_coupons: 'Coupon Strategies',
    nav_coupon_history: 'Coupon History',
    nav_system_active: 'System Active',

    home_title: 'DAILY MATCHES',
    home_subtitle: 'Follow all ice hockey matches live, access advanced analysis and predictions',
    home_live: 'Live',
    home_upcoming: 'Upcoming',
    home_finished: 'Finished',
    home_all_statuses: 'All Statuses',
    home_all_leagues: 'All Leagues',
    home_matches: 'matches',
    home_no_matches: 'No matches found for selected date and filters',
    home_last_update: 'Last updated',

    match_back: 'Back to Matches',
    match_analyzing: 'Analyzing...',
    match_not_found: 'Match not found',
    match_finished: 'Finished',
    match_tab_analysis: 'Analysis & Prediction',
    match_tab_smart_bets: 'Smart Bets',
    match_tab_value_bets: 'Value Bets',
    match_tab_player_props: 'Player Predictions',
    match_tab_odds: 'Odds',
    match_tab_h2h: 'H2H',
    match_tab_events: 'Events',

    analysis_win_prob: 'WIN PROBABILITIES',
    analysis_expected_goals: 'EXPECTED GOALS',
    analysis_over_under: 'OVER/UNDER PROBABILITIES',
    analysis_likely_scores: 'MOST LIKELY SCORES',
    analysis_team_stats: 'TEAM STATISTICS COMPARISON',
    analysis_home: 'Home',
    analysis_away: 'Away',
    analysis_draw: 'Draw',
    analysis_total: 'Total',
    analysis_confidence: 'Confidence Score',
    analysis_actual_result: 'Actual Result',
    analysis_actual: 'Actual',
    analysis_btts_yes: 'BTTS Yes',
    analysis_btts_no: 'BTTS No',
    analysis_form_score: 'Form Score',

    smart_title: 'SMART BET ANALYSIS',
    smart_subtitle: 'Low-risk, high-value betting opportunities',
    smart_description: 'This tab identifies low-risk but high-value bets. Analyzes safe bet types like Double Chance, BTTS, Over/Under to find mispriced opportunities.',
    smart_low_risk: 'Low Risk',
    smart_high_value: 'High Value',
    smart_positive_edge: 'Positive Edge',
    smart_all: 'All',
    smart_no_bets: 'No bets found with this filter',

    value_detected: 'Value Bets Detected',
    value_description: 'The higher the edge percentage, the more profitable the bet is expected to be long-term.',
    value_no_bets: 'No value bets found for this match',
    value_true_prob: 'True Probability',
    value_implied_prob: 'Implied Probability',
    value_edge: 'Edge (Advantage)',
    value_kelly: 'Kelly Fraction',

    player_title: 'PLAYER PREDICTIONS',
    player_analyzed: 'player bets analyzed',
    player_description: 'Player-based bets often offer high odds. Predictions based on goal scoring, assists, shots, and points.',
    player_all: 'All',
    player_goal: 'Goal',
    player_shot: 'Shot',
    player_point: 'Point',
    player_assist: 'Assist',
    player_positive_only: 'Positive Edge Only',
    player_no_predictions: 'No player predictions found with this filter',
    player_estimated: 'Estimated',
    player_confidence_label: 'Confidence',
    player_more: 'more predictions available',

    odds_bookmakers: 'bookmakers',
    odds_bet_types: 'bet types',
    odds_results_showing: 'Results showing',
    odds_no_odds: 'No odds found for this match',
    odds_selection: 'Selection',
    odds_best_odds: 'Best Odds',
    odds_bookmaker: 'Bookmaker',
    odds_avg_odds: 'Avg Odds',
    odds_result: 'Result',
    odds_options: 'options',

    h2h_title: 'HEAD TO HEAD STATISTICS',
    h2h_matches: 'matches',
    h2h_home_wins: 'Home Wins',
    h2h_draws: 'Draws',
    h2h_away_wins: 'Away Wins',
    h2h_avg_goals: 'Avg Total Goals',
    h2h_over25: 'Over 2.5 Rate',
    h2h_btts: 'BTTS Rate',
    h2h_recent: 'RECENT MATCHES',
    h2h_no_data: 'No head-to-head match history found',

    events_title: 'MATCH EVENTS',
    events_no_data: 'No match events found',
    events_goal: 'GOAL',
    events_penalty: 'PENALTY',
    events_assist: 'Assist',

    risk_very_low: 'Very Low Risk',
    risk_low: 'Low Risk',
    risk_medium: 'Medium Risk',
    risk_high: 'High Risk',

    result_won: 'WON',
    result_lost: 'LOST',
    result_void: 'VOID',
    result_pending: 'PENDING',

    rating_excellent: 'Excellent',
    rating_good: 'Good',
    rating_moderate: 'Moderate',
    rating_low: 'Low',

    coupons_title: 'COUPON STRATEGIES',
    coupons_subtitle: 'AI-powered analysis for today\'s most valuable bets',
    coupons_analysis: 'Analysis',
    coupons_value_bet: 'Value Bet',
    coupons_coupon: 'Coupon',
    coupons_recommended: 'RECOMMENDED COUPONS',
    coupons_total_odds: 'total odds',
    coupons_expected_prob: 'Expected Probability',
    coupons_expected_value: 'Expected Value',
    coupons_suggested_stake: 'Suggested Stake',
    coupons_potential_return: 'Potential Return',
    coupons_unit: 'units',
    coupons_save: 'Save Coupon',
    coupons_bets: 'bets',
    coupons_no_strategy: 'No coupon strategies could be created today',
    coupons_no_strategy_desc: 'Not enough value bets or insufficient matches',
    coupons_by_game: 'VALUE BETS BY GAME',
    coupons_disclaimer_title: 'Disclaimer',
    coupons_disclaimer: 'These predictions are based on statistical models and do not guarantee results. Do your own research before betting. Never bet more than you can afford to lose.',
    coupons_analyzing: 'Analyzing',
    coupons_fetching: 'Fetching daily matches...',
    coupons_creating: 'Creating coupon strategies...',
    coupons_score: 'Score',

    history_title: 'COUPON HISTORY',
    history_subtitle: 'Results and performance tracking for saved coupons',
    history_no_coupons: 'No saved coupons yet',
    history_no_coupons_desc: 'You can save coupons from the Coupon Strategies page.',
    history_go_coupons: 'Go to Coupon Strategies',
    history_all: 'All',
    history_pending: 'Pending',
    history_won: 'Won',
    history_lost: 'Lost',
    history_partial: 'Partial',
    history_total_stake: 'Total Stake',
    history_total_return: 'Total Return',
    history_profit: 'Profit/Loss',
    history_roi: 'ROI',
    history_avg_odds: 'Avg Odds',
    history_delete: 'Delete',
    history_delete_confirm: 'Are you sure you want to delete this coupon?',

    standings_title: 'STANDINGS',
    standings_subtitle: 'Current standings for all leagues',
    standings_select_league: 'Select League',
    standings_loading: 'Loading standings...',
    standings_no_data: 'No standings found for this league',
    standings_pos: '#',
    standings_team: 'Team',
    standings_played: 'GP',
    standings_won_short: 'W',
    standings_lost_short: 'L',
    standings_goals_for: 'GF',
    standings_goals_against: 'GA',
    standings_points: 'Pts',
    standings_form: 'Form',

    stat_played: 'Games Played',
    stat_wins: 'Wins',
    stat_losses: 'Losses',
    stat_goals_scored: 'Goals Scored',
    stat_goals_conceded: 'Goals Conceded',
    stat_goals_avg_scored: 'Goals Avg (Scored)',
    stat_goals_avg_conceded: 'Goals Avg (Conceded)',
    stat_home_wins: 'Home Wins',
    stat_win_pct: 'Win %',

    common_odds: 'odds',
    common_probability: 'probability',
    common_vs: 'vs',
    common_loading: 'Loading...',
    common_error: 'Error',
    common_back: 'Back',
    common_save: 'Save',
    common_delete: 'Delete',
    common_close: 'Close',
    common_won: 'Won',
    common_lost: 'Lost',
    common_success: 'success',
  },
} as const;

export type TranslationKey = keyof typeof translations.tr;

export function getTranslations(locale: Locale): Record<TranslationKey, string> {
  return translations[locale];
}

export function t(locale: Locale, key: TranslationKey): string {
  return translations[locale]?.[key] || translations.en[key] || key;
}
