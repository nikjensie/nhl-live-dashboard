# Rinkside – NHL live-dashboard

Översikt över nattens NHL-matcher: period och klocka, spelsituation (Even Strength, Power Play, Shorthanded, tom bur), en målfeed i kronologisk ordning med målgörare och passningsläggare, och dina Yahoo Fantasy Hockey-matchups i alla ligor du är med i.

- **Matcher** – pågående först, sedan kommande och avslutade. Tryck på ett matchkort för en boxscore med resultat per period, skott, alla mål med assist och NHL:s officiella spelarstatistik per lag (mål, assist, poäng, +/-, skott, istid). Klockan och powerplay-tiden tickar lokalt mellan uppdateringarna (var 10:e sekund när matcher pågår).
- **Radio** – lagloggorna i matchkortets topprad startar lagets egen radiosändning (samma strömmar som NHL.com använder). Ljudet spelas i en liten spelare längst ned; Safari spelar strömmen direkt, övriga webbläsare via hls.js (`public/vendor/`, Apache-2.0). Länkarna finns medan matchen pågår (`api/radio.js`).
- **Nattens mål** – alla mål från dagens matcher, senaste först (kan vändas). Nya mål blinkar på matchkortet, dyker upp som notis och markeras i feeden. Med högtalarknappen i toppen spelas ett målhorn i arenastil (syntetiserat i webbläsaren). Under varje mål i lika numerär eller boxplay visas vilka utespelare som var på isen och vem som fick + respektive − (inte för PP- eller straffslagsmål, enligt NHL:s regler). Uppgifterna kommer från NHL:s bytesdata, som publiceras med några minuters fördröjning.
- **Fantasy** – logga in med Yahoo. Kategoriligor visar vinster/förluster per kategori, poängligor visar poäng och prognos. Spelare i ditt lag markeras **orange** och motståndarens **ljusblå** överallt i appen (målfeed, +/-, boxscore, notiser), med ligatagg om du är med i flera ligor. Bänk- och IR-spelare får streckad markering. "Bara matchups" i målkolumnen filtrerar fram mål som berör dina matchups. Yahoo och NHL har olika spelar-ID, så kopplingen görs på lag + efternamn + förnamnsinitial (`public/marks.js`).
- **Vecka** – egen vy (växeln Live/Vecka i toppen, fliken Vecka på mobilen) med antal matcher och motståndare per lag och dag för innevarande vecka (idag–söndag) eller nästa vecka (mån–sön). Bortamatcher markeras med @, B2B när motståndaren spelade dagen innan, lagen med flest/färst matcher färgmarkeras, och en grön ▲ / röd ▼ vid motståndaren i cellen visar motståndarens form enligt ett formindex (se nedan) (förluster efter förlängning/straffar räknas som förluster) – praktiskt för fantasy-streaming (`api/week.js`, `lib/week.js`).
- **Prognoser** – varje matchkort får en prognos (resultat, vinstchans, målvaktsstatus). Första preliminära prognosen läggs kl. 17:00 svensk tid på matchdagen, räknas om var 30:e minut och låses 30 minuter före nedsläpp. Den låsta prognosen ligger kvar under och efter matchen, där utfallet markeras: **SPOT ON!** (exakt resultat inklusive avgörande i ordinarie tid eller förlängning), **PROGNOSIS POSITIVE** (förlängning som prognosen sa och rätt lag vann), **RÄTT VINNARE** (rätt lag vann i ordinarie tid) eller **PROGNOSIS NEGATIVE** (fel lag vann, eller prognosen sa ordinarie tid men matchen gick till förlängning). Tryck på ett kommande matchkort för detaljer. Skjutknappen "Prognoser" slår av/på alla. Se *Prognosmodellen* nedan.
- **Tema** – knappen i toppen växlar mellan Auto (följer enhetens inställning), Ljust och Mörkt. Valet sparas i webbläsaren, och lagloggorna byter till NHL:s variant för ljus respektive mörk bakgrund.
- **Mobil** – tre flikar längst ned: Matcher, Mål (med räknare för nya mål) och Fantasy.

**Vilken dag visas?** Standardvyn visar NHL:s matchdag (amerikansk östkusttid), så nattens matcher hör till samma dag även när de spelas efter midnatt svensk tid. Gårdagens matchdag visas så länge någon av dess matcher pågår; när alla är klara byter vyn till dagens datum enligt östkusttid (tidigast kl. 06 svensk tid). Andra dagar nås med pilarna eller kalendern.

Testa utseendet utan pågående matcher: öppna `/?demo`.

> **Fantasy-delen är dold tills vidare.** Yahoo kräver sedan juli 2026 att appar godkänns för Fantasy-API:et (ansökan: <https://sports.yahoo.com/developer/access/>). Innan dess svarar API:et 403. Visa delen med `/?fantasy` (eller `/?demo&fantasy`).

## Kom igång lokalt

Kräver Node 18+. Inga npm-beroenden.

```bash
cp .env.example .env.local   # fyll i värdena nedan
npm run dev                  # http://localhost:3000
npm test                     # enhetstester för tolkningen av NHL- och Yahoo-data
```

NHL-delen fungerar direkt utan konfiguration.

## Yahoo-inloggning

1. Gå till <https://developer.yahoo.com/apps/create/> och skapa en app.
   - **Application type:** Web Application
   - **Redirect URI(s):** `https://<din-app>.vercel.app/api/auth/callback`
   - **API Permissions:** Fantasy Sports → Read
2. Kopiera **Client ID** och **Client Secret**.
3. Sätt miljövariablerna (lokalt i `.env.local`, på Vercel under *Settings → Environment Variables*):

| Variabel | Värde |
|---|---|
| `YAHOO_CLIENT_ID` | Client ID från Yahoo |
| `YAHOO_CLIENT_SECRET` | Client Secret från Yahoo |
| `YAHOO_REDIRECT_URI` | Exakt samma redirect-URI som hos Yahoo |
| `SESSION_SECRET` | Slumpsträng, minst 32 tecken: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

Yahoo kräver https för redirect-URI, så inloggningen testas enklast på Vercel (eller via en https-tunnel lokalt).

Token lagras krypterat (AES-256-GCM) i en HttpOnly-cookie och förnyas automatiskt. Ingen databas behövs.

## Driftsättning på Vercel

```bash
gh repo create nhl-live-dashboard --private --source=. --push
```

Importera sedan repot på vercel.com (Framework preset: *Other*, inga build-inställningar behövs – `vercel.json` pekar ut `public/` och funktionerna i `api/`), lägg in miljövariablerna och driftsätt.

## Struktur

```
api/scores.js          NHL: matcher + mål för en dag (cachas 5 s på Vercels edge)
lib/espn.js            Riktiga klockslag för mål från ESPN
api/onice.js           NHL: spelare på isen och +/- per mål (play-by-play + shiftcharts)
api/radio.js           NHL: lagens radiosändningar (HLS) för en match
api/boxscore.js        NHL: officiell spelarstatistik (+/-, istid, skott) för boxscoren
api/week.js            NHL: veckoschema – matcher per lag denna/nästa vecka
api/predictions.js     Matchprognoser (NHL + ESPN), låses och sparas i Vercel Blob
api/fantasy.js         Yahoo: din matchup i varje NHL-liga
api/auth/*.js          Yahoo OAuth 2.0 (login, callback, logout)
lib/nhl.js             Hämtning och tolkning av NHL-data, situationCode -> PP/SH/EV
lib/yahoo.js           Yahoo OAuth + tolkning av Yahoos JSON
lib/session.js         Krypterad session-cookie
public/                Frontend (HTML/CSS/JS utan ramverk)
dev-server.js          Lokal server som kör api/ som Vercel gör
```

## Hur spelsituationen räknas ut

NHL anger en `situationCode` med fyra siffror: bortamålvakt, bortautespelare, hemmautespelare, hemmamålvakt. `1451` betyder alltså att bortalaget har fyra utespelare mot hemmalagets fem, dvs. hemmalaget spelar powerplay. När en målvakt är uttagen (`0`) räknas den extra utespelaren inte som numerärt överläge, så `0651` visas som *Tom bur* och inte som powerplay.

## Formindex (veckoschemat)

Bygger på de lagmått som definieras i [jordanpolischuk/nhl_trend_tracker](https://github.com/jordanpolischuk/nhl_trend_tracker) (`fact_team_day`: vinstrad samt vinster och mål för/emot över de senaste 10 matcherna). Repot innehåller ännu ingen färdig formel, så vägningen är vår egen (`lib/week.js`, `computeForm`):

```
index = 100 · (0,40·P + 0,35·M + 0,25·R)      −100 … +100
P = (poängprocent − 0,5) · 2                  poängprocent = (2·V + Fö) / (2·matcher), senaste 10
M = clamp(målskillnad per match, ±2) / 2      straffmål räknas inte
R = clamp(win_streak, ±5) / 5                 + raka vinster, − raka förluster (även efter förl./straffar)
```

▲ vid index ≥ +35, ▼ vid ≤ −35, minst 5 spelade matcher. Underlaget är NHL:s schema för de senaste 28 dagarna. xG ingår inte eftersom NHL inte publicerar det per match i de öppna API:erna.

## Prognosmodellen

`lib/predict.js` (modell), `lib/predict-data.js` (datainsamling), `api/predictions.js` (schemaläggning och lagring).

1. **Grund:** förväntade mål per lag enligt Poisson – anfall och försvar relativt ligasnittet (NHL-tabellen, regression mot snittet tidigt på säsongen) och hemmafördel (+4 %).
2. **Form:** formindexet från veckoschemat (±8 % egna mål, ±5 % motståndarens).
3. **Inbördes möten:** de 5 senaste mötena denna och förra säsongen (NHL), ±2 % per mål i snittmålskillnad.
4. **Skador:** ESPN:s skadelista viktad med spelarnas poäng per match (NHL). Spelare vars förväntade återkomst är matchdagen räknas som tillbaka och ger ett lyft.
5. **Startmålvakter:** ESPN:s *Confirmed/Expected*; startmålvaktens räddningsprocent mot lagets snitt justerar motståndarens förväntade mål (max ±10 %, målvakter med få matcher dras mot ligasnittet).
6. **Back-to-back:** lag som spelade dagen innan −4 % egna mål, +3 % insläppta.

Vinstchans = sannolikheten att vinna i ordinarie tid + andelen av oavgjort som avgörs i förlängning/straffar efter relativ styrka. Det visade resultatet är det mest sannolika där favoriten vinner (eller vinst i förlängning om oavgjort efter 60 min är mest sannolikt).

**Schema och lagring:** kl. 17:00 svensk tid på matchdagen (NHL:s datum) räknas den första prognosen; därefter ny beräkning när den är äldre än 30 minuter, fram till 30 minuter före nedsläpp då den låses. Prognoser sparas i Vercel Blob (`predictions/YYYY-MM-DD.json`) så att den låsta prognosen kan visas och jämföras med resultatet. Matcher utan sparad prognos får ingen i efterhand. `.github/workflows/predictions.yml` anropar API:et var 30:e minut så att det sker även när ingen har sidan öppen.

## Om måltiderna

NHL:s API anger bara tiden i perioden, inte klockslaget. Klockslagen hämtas därför från ESPN:s öppna API (`wallclock` per händelse) och paras ihop med NHL:s mål per period, med kontroll av målgörarens namn. Finns ingen säker matchning används i stället tiden då sidan såg målet dyka upp, eller en uppskattning utifrån matchstart (visas med `~`).

Data från NHL:s inofficiella publika API och Yahoo Fantasy Sports API. Inte associerat med NHL eller Yahoo.
