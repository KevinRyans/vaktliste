# Vaktliste – Quality Hotel Tønsberg

En lettlest «leser» for restaurantens vaktliste. Den henter dataene direkte fra
Sarahs Google-ark og viser dem pent på mobil og desktop, med markering av dagens
vakt og en egen «hvem er på jobb»-visning. Endringer i arket dukker opp i appen i
nær sanntid.

Tilgang styres av **Google-pålogging**: den som åpner appen logger inn med Google,
og slipper inn hvis Google-arket er delt med e-posten deres. Ingen felles kode å
dele eller huske – og man forblir innlogget på enheten.

## Innhold
- [Slik fungerer det](#slik-fungerer-det)
- [Engangsoppsett (administrator)](#engangsoppsett-administrator)
  - [1. Opprett Google Cloud-prosjekt + OAuth Client ID](#1-opprett-google-cloud-prosjekt--oauth-client-id)
  - [2. Lim inn Client ID i appen](#2-lim-inn-client-id-i-appen)
  - [3. Del arket med de ansatte](#3-del-arket-med-de-ansatte)
  - [4. (Valgfritt) Legg inn Quality-logoen](#4-valgfritt-legg-inn-quality-logoen)
- [Hvordan ansatte bruker den](#hvordan-ansatte-bruker-den)
- [Vedlikehold og tips](#vedlikehold-og-tips)
- [Feilsøking](#feilsøking)
- [Teknisk](#teknisk)

## Slik fungerer det
1. Brukeren logger inn med Google. Appen ber kun om lese­tilgang til regneark.
2. Appen prøver å lese **det ene** konfigurerte arket med brukerens egen konto.
   - Klarer den det → brukeren er godkjent og ser vaktlisten.
   - Får den «ingen tilgang» (403) → brukeren får beskjed om å be admin dele arket.
3. Dataene tolkes (avdeling pr. fane, personer pr. rad, datoer pr. kolonne) og vises.
4. Appen poller arket hvert 30. sekund og når appen tas fram igjen, og oppdaterer
   visningen automatisk når noe er endret.

> Tilgang = deling. Du trenger **ingen** egen liste over eposter inni arket – det er
> hvem arket er delt med i Google som bestemmer. Arket kan være helt privat.

## Engangsoppsett (administrator)

Du trenger å gjøre tre ting én gang: lage en Google «Client ID», lime den inn i
koden, og dele arket med de ansatte.

### 1. Opprett Google Cloud-prosjekt + OAuth Client ID

1. Gå til <https://console.cloud.google.com/> og logg inn med Google-kontoen som
   skal eie oppsettet.
2. Øverst: **velg prosjekt → Nytt prosjekt**. Gi det et navn (f.eks. «Vaktliste»)
   og opprett.
3. Slå på Sheets API: meny → **APIs & Services → Library**, søk **Google Sheets
   API**, åpne den og trykk **Enable**.
4. Sett opp samtykkeskjermen: **APIs & Services → OAuth consent screen**.
   - **User type:**
     - Har hotellet en Google Workspace-konto og alle ansatte bruker den? Velg
       **Internal** (ingen advarsel, ingen grense).
     - Bruker ansatte vanlig Gmail/private kontoer? Velg **External**.
   - Fyll inn appnavn («Vaktliste»), support-epost og din epost som kontakt. Lagre.
   - (Kun External) under **Audience/Publishing status**, trykk **Publish app /
     Push to production** så hvem som helst kan logge inn. Se merknad om
     «ikke-verifisert app» i [Feilsøking](#feilsøking).
5. Lag selve nøkkelen: **APIs & Services → Credentials → Create credentials →
   OAuth client ID**.
   - **Application type:** Web application.
   - **Name:** f.eks. «Vaktliste web».
   - **Authorized JavaScript origins** → legg til der appen kjøres, uten slutt-slash:
     - `https://vaktliste.xyz`
     - (valgfritt for testing) `http://localhost:8080`
   - **Authorized redirect URIs** trenger du ikke for denne flyten – la stå tomt.
   - Trykk **Create**. Kopier **Client ID** (ser ut som
     `1234567890-abcd…apps.googleusercontent.com`).

### 2. Lim inn Client ID i appen

Åpne `script.js` og fyll inn øverst i `CONFIG`:

```js
const CONFIG = {
  GOOGLE_CLIENT_ID: 'DIN_CLIENT_ID.apps.googleusercontent.com', // ← lim inn her
  SPREADSHEET_ID:   '1V1irD06qK8Cv1_XA6_qHTJYKVG_eH9ySEmgiGl6UyVE', // ← arkets ID
  POLL_INTERVAL:    30 * 1000,  // hvor ofte (ms) appen sjekker for endringer
  LOGO_URL:         '',         // valgfri logo, se punkt 4
};
```

`SPREADSHEET_ID` er allerede satt til dagens ark – den står i ark-URL-en mellom
`/d/` og `/edit`. Bytt den hvis dere går over til et nytt ark.

### 3. Del arket med de ansatte

Åpne Google-arket → **Del** → legg til e-postadressene til alle som skal ha
tilgang, med rollen **Seer (Viewer)**. Det er denne delingen som gir folk tilgang
i appen. Legger du til en ny ansatt senere, deler du bare arket med eposten deres –
de slipper inn neste gang de logger inn (eller trykker «Prøv igjen»).

> Arket trenger **ikke** lenger være «alle med lenken kan se». Du kan holde det
> privat og bare dele med de aktuelle epostene.

### 4. (Valgfritt) Legg inn Quality-logoen

Når du har en logo-fil eller bilde-URL, sett den i `CONFIG.LOGO_URL` i `script.js`:

```js
LOGO_URL: 'https://…/quality-logo.png',
```

Logoen vises da i den firkantede merket i headeren (på både innloggings­skjermen
og i appen). Uten URL vises en pen «Q»-tekstlogo som fallback.

## Hvordan ansatte bruker den
1. Åpne appen (f.eks. `https://vaktliste.xyz`).
2. Trykk **Logg inn med Google** og velg jobb-/privat­kontoen som arket er delt med.
3. Velg avdeling og navn – egne vakter vises, med dagens vakt markert.
4. Bla i «Hvem er på jobb» for å se hvem andre som er satt opp en gitt dag.
5. Appen husker innloggingen. Legg den gjerne til på hjemskjermen for app-følelse.

## Vedlikehold og tips
- **Endre vaktlisten** som vanlig i Google-arket – appen oppdaterer seg selv.
- **Ny ansatt:** del arket med eposten deres. Ferdig.
- **Fjerne tilgang:** fjern eposten fra delingen på arket.
- Gi arket et navn med måned og år (f.eks. «Vaktliste november 2025») slik at
  datoene tolkes riktig hvis kolonnene bare har dagnummer.
- «Oppdater»-knappen øverst tvinger en henting med en gang.

## Feilsøking
- **«Mangler tilgang» etter innlogging:** eposten er ikke delt på arket. Del arket
  med den aktuelle eposten, og trykk **Prøv igjen** (eller **Bytt konto** hvis de
  logget inn med feil konto).
- **«Mangler oppsett»:** `GOOGLE_CLIENT_ID` er ikke fylt inn i `script.js`.
- **Google viser «Denne appen er ikke verifisert»:** normalt for en upublisert/
  uverifisert External-app. Brukeren trykker **Avansert → Fortsett til
  vaktliste.xyz**. Uverifiserte apper med sensitive scopes har en grense på 100
  brukere; for et restaurant-team holder det. Vil du fjerne advarselen helt, kan du
  enten bruke **Internal** (Workspace) eller sende appen til Google-verifisering.
- **Ingenting skjer ved innlogging:** sjekk at domenet appen kjøres på står under
  **Authorized JavaScript origins** på Client ID-en (uten slutt-slash).

## Teknisk
- Ren HTML, CSS og JavaScript – ingen byggesteg og ingen server.
- Google Identity Services (GIS) for pålogging; access-token fornyes stille i
  bakgrunnen så brukeren i praksis aldri logges ut.
- Google Sheets API (`spreadsheets.readonly`) leser arket som JSON – ingen XLSX/
  SheetJS lenger.
- Data caches i `localStorage` (nøkkel pr. ark-ID) for umiddelbar oppstart, og
  re-rendres kun når innholdet faktisk har endret seg.

## Lisens
Åpen kildekode – bruk og modifiser fritt etter behov.

## Laget av
- **Michael Firing** (original initiativtaker/utvikler)
