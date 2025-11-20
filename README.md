# Vaktliste

En enkel webapp som henter en vaktplan direkte fra et Google-regneark og gjør den lett å lese på mobil og desktop. Planen caches lokalt for rask oppstart, men appen oppdaterer automatisk slik at ansatte slipper å slette hjemskjerm-appen når planen endres.

## Hva prosjektet er laget for
- Gi ansatte en rask oversikt over vaktene sine uten å åpne regnearket.
- Støtte filtrering på avdeling og person, samt en «kun fremtidige vakter»-visning.
- Vise ukentlig vaktliste pr. avdeling i tillegg til personvisning.
- Laste inn siste endringer automatisk i bakgrunnen og når appen tas fram igjen.

## Hva prosjektet er laget av
- **Michael Firing** (original initiativtaker/utvikler)
- Ren HTML, CSS og JavaScript, med [SheetJS](https://sheetjs.com/) til å lese XLSX-eksporten fra Google Sheets.

## Hvordan det fungerer
1. Administrator kopierer delingslenken til regnearket og oppdaterer `SHEET_SHARE_LINK` i `script.js`.
2. Appen konverterer lenken til en XLSX-eksport-URL og henter filen med `fetch` (uten cache).
3. SheetJS parser arbeidsboken til et dataset som knyttes til avdeling, personer og datoer.
4. Resultatet lagres i `localStorage` med tidsstempel og kilde-URL. Cachen invalides automatisk når lenken endres eller data er eldre enn refresh-intervallet.
5. Når appen gjenåpnes fra bakgrunnen, sjekker den om dataene er gamle og henter eventuelle endringer.

## Kom i gang
1. Åpne `index.html` i en nettleser (eller host filene på en enkel webserver).
2. Oppdater `SHEET_SHARE_LINK` i `script.js` med din Google Sheets-delingslenke ("Del" → "Kopier lenke").
3. Sørg for at regnearket er delt slik at hvem som helst med lenken kan lese.
4. Be brukere legge siden til hjemskjermen om de vil; appen vil oppdatere seg selv uten reinstallasjon når regnearket endres.

## Vanlige tips
- Gi regnearkfilene tydelige navn med måned og år (f.eks. `Vaktliste november 2025.xlsx`) slik at datoene tolkes korrekt.
- Bruk "Oppdater nå"-knappen i appen for å tvinge en henting hvis du nylig har endret arket.
- Hvis du bytter til et nytt ark, trenger ikke brukerne gjøre noe: den lagrede planen matches mot kilde-URLen og lastes inn på nytt automatisk.

## Lisens
Dette prosjektet er åpen kildekode; bruk og modifiser fritt etter behov.
