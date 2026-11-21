# Puntenjacht – testversie

Een mobiele webapp voor opdrachtkaarten, teamclaims en een scorebord. Zonder Supabase-instellingen start de website in lokale demo-modus. Voeg Supabase-instellingen toe om teams en scores tussen apparaten te delen.

## 1. Snel lokaal bekijken

Installeer Node.js 20 of hoger. Open daarna een terminal in deze projectmap en voer uit:

```bash
npm install
npm run dev
```

Open de lokale URL die Vite in de terminal toont. Je ziet de voorbeeldkaarten en kunt tussen drie voorbeeldteams wisselen. Deze demo bewaart claims alleen in de browser waarin je hem gebruikt.

## 2. Supabase-database maken

1. Maak een project aan op [supabase.com](https://supabase.com/).
2. Open in het project **SQL Editor** en maak een nieuwe query.
3. Plak de volledige inhoud van `supabase/schema.sql` en voer die uit.
4. Open **Authentication → Providers → Email** en controleer dat e-mail/wachtwoord is ingeschakeld. Tijdens een besloten test kun je e-mailbevestiging uitzetten. Laat je die aanstaan, dan moet ieder team eerst de bevestigingsmail openen.
5. De SQL maakt een spel aan met drie teams en vier voorbeeldopdrachten. De testcodes zijn `RAAF-7D4F9`, `OTTER-3B8Q1` en `FOX-6K2M4`.

Maak per team één e-mailaccount aan op de website. Het team gebruikt dat account op de telefoons van de teamleden en koppelt het met de bijbehorende teamcode. Teamcodes zijn voor de test eenvoudig; vervang ze voordat je de site met anderen deelt.

## 3. Website verbinden met Supabase

Kopieer `.env.example` naar `.env.local`. Vul de project-URL en publishable key in. Je vindt beide in Supabase onder **Project Settings → API**.

```dotenv
VITE_SUPABASE_URL=https://jouw-project-id.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_jouw_sleutel
```

De publishable key hoort bij een browserapp. Gebruik hier nooit een `service_role`- of secret key. De databasepolicies beperken welke gegevens een ingelogd team kan lezen; claims worden door een databasefunctie gecontroleerd.

Herstart daarna de lokale server (`npm run dev`). Als de variabelen ontbreken, blijft de site in de lokale demo-modus.

## 4. Naar GitHub en online zetten

1. Maak een lege repository aan op GitHub.
2. Upload de inhoud van deze projectmap naar de **root** van de repository. Zorg dat `package.json`, `index.html` en `src/` op het hoogste niveau staan.
3. Maak een Vercel-account aan en importeer de GitHub-repository.
4. Kies Vite als framework. Voeg bij **Environment Variables** dezelfde twee variabelen toe als hierboven.
5. Klik op **Deploy**. Een volgende push naar `main` triggert een nieuwe versie. De GitHub Action in `.github/workflows/build.yml` controleert bij pushes en pull requests ook of de website bouwt.

Zonder environment variables kan de gepubliceerde website wel de lokale demo tonen, maar synchroniseert hij geen teams of scores.

## 5. Teams en opdrachten aanpassen

Voor deze testversie is er nog geen beheerpagina. Beheer het spel via Supabase **Table Editor**:

- Pas opdrachten aan in `tasks`. Moeilijkheden zijn `easy`, `medium` en `hard`; `points` moet groter zijn dan nul.
- Zet `active` uit om een opdracht tijdelijk te verbergen.
- Voeg een team toe in `teams` en een bijbehorende code in `team_join_codes`. Beide rijen moeten bij hetzelfde spel horen.
- Pauzeer of beëindig het spel door `games.status` op `paused` of `completed` te zetten. Om opnieuw claims toe te staan, zet de status op `active`.

Een taak kan per team één keer worden geclaimd. Dezelfde taak blijft beschikbaar voor andere teams. Het scorebord vernieuwt automatisch elke acht seconden.

## Database-onderdelen

- `games`: spelnaam en status.
- `teams`: teams die aan een spel deelnemen.
- `team_join_codes`: codes waarmee accounts aan teams worden gekoppeld; deze tabel is niet toegankelijk voor de browser.
- `team_accounts`: account/team-koppeling.
- `tasks`: opdrachtkaarten en punten.
- `claims`: ingediende claims met de puntenwaarde op het moment van claimen.

De SQL schakelt Row Level Security in. De website krijgt alleen leesrechten volgens policies; databasefuncties controleren het koppelen van teams en claimen van opdrachten. Een uniek databaseveld voorkomt dubbele claims door dubbelklikken of gelijktijdige verzoeken.
