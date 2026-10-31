# Rinkside – NHL live-dashboard

Översikt över nattens NHL-matcher: period och klocka, spelsituation (Even Strength, Power Play, Shorthanded, tom bur), en målfeed i kronologisk ordning med målgörare och passningsläggare, och dina Yahoo Fantasy Hockey-matchups i alla ligor du är med i.

- **Matcher** – pågående först, sedan kommande och avslutade. Klockan och powerplay-tiden tickar lokalt mellan uppdateringarna (var 10:e sekund när matcher pågår).
- **Nattens mål** – alla mål från dagens matcher, senaste först (kan vändas). Nya mål blinkar på matchkortet, dyker upp som notis och markeras i feeden. Under varje mål i lika numerär eller boxplay visas vilka utespelare som var på isen och vem som fick + respektive − (inte för PP- eller straffslagsmål, enligt NHL:s regler). Uppgifterna kommer från NHL:s bytesdata, som publiceras med några minuters fördröjning.
- **Fantasy** – logga in med Yahoo. Kategoriligor visar vinster/förluster per kategori, poängligor visar poäng och prognos.
- **Mobil** – tre flikar längst ned: Matcher, Mål (med räknare för nya mål) och Fantasy.

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
api/onice.js           NHL: spelare på isen och +/- per mål (play-by-play + shiftcharts)
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

## Om måltiderna

NHL:s API anger inte när på natten ett mål gjordes, bara tiden i perioden. För mål som redan fanns när sidan öppnades uppskattas klockslaget (visas med `~`). Mål som dyker upp medan sidan är öppen får exakt klockslag, och det sparas i webbläsaren.

Data från NHL:s inofficiella publika API och Yahoo Fantasy Sports API. Inte associerat med NHL eller Yahoo.
