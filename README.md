# Puntenjacht

A mobile-friendly web app for team challenge cards, claims, and a live scoreboard. Cards and scores are stored in Supabase so teams can use different phones.

## Update the existing Supabase project

The app now uses individual player accounts. Each account joins one team with that team's private code or QR link. The database will not let that account join a different team later. The first team to claim a card gets it; the database rejects every later claim, including simultaneous attempts.

1. In Supabase, open **SQL Editor**, create a query, paste all of `supabase/migration_team_members_global_claims.sql`, and run it once.
2. In GitHub, replace the project files with this updated version and push to the branch connected to Vercel. Vercel will deploy the update.
3. In Supabase **Authentication → Providers → Email**, leave email/password enabled. For a private test, you may turn off email confirmation; otherwise players must confirm their email before joining.
4. Replace the sample team codes under **Table Editor → team_join_codes** before sharing the site. Do not commit real team codes to a public GitHub repository.

The migration keeps existing team/account links. If a card was previously claimed by multiple teams, it keeps the earliest claim and removes later claims for that card so the new one-claim rule can be enforced.

## Set up a new Supabase project

For a completely new database, use `supabase/schema.sql` instead of the migration:

1. Create a Supabase project.
2. Open **SQL Editor**, paste all of `supabase/schema.sql`, and run it once.
3. Replace the sample team codes before sharing the site.

The sample game ID is `11111111-1111-4111-8111-111111111111`. The SQL creates three sample teams and four sample cards.

## Team logins and QR codes

Each player creates their own account on the website, signs in, then enters their team's code. A team can use the same code for all of its players. To make a QR code for a team, use a link like:

```text
https://your-site.vercel.app/?team_code=YOUR-TEAM-CODE
```

Replace the domain and code with the live site's address and that team's code, then turn the link into a QR image. After scanning, the code is prefilled on the join screen. Share each QR privately with its team. If a player has already linked their account, the database blocks joining another team with that account. A person could still make a separate account if they get another team's code, so keep codes private and replace a code if it leaks.

The current quick setup uses team codes. To assign specific players to teams in advance, first have them create accounts, then add each account to `team_members` from **Supabase → SQL Editor**. Find each user's ID in **Authentication → Users** and the team's ID in **Table Editor → teams**. Run one insert per user:

```sql
insert into public.team_members (user_id, team_id)
values ('<AUTH_USER_UUID>'::uuid, '<TEAM_UUID>'::uuid);
```

An assigned account opens the site and goes straight to its team. The account cannot join a different team through the website.

If you want to require manual assignment for every player, first assign all players, then disable self-service code joining:

```sql
revoke execute on function public.join_team_by_code(text) from authenticated;
```

An unassigned player will then be told to contact the organizer. To enable QR/code joining again later, run:

```sql
grant execute on function public.join_team_by_code(text) to authenticated;
```

## Add cards

The live website reads cards from the Supabase `tasks` table. The file `data/cards_template.csv` is a convenient spreadsheet template and backup; changing that file in GitHub alone does not change the live website.

1. Open `data/cards_template.csv` in Excel.
2. Add one row per card. Use the sample game's `game_id` shown above, or the ID of the game you created in Supabase.
3. Save or export the sheet as **CSV UTF-8**. Keep the column headers as they are. Use only `easy`, `medium`, or `hard` in `difficulty`; `points` must be a positive whole number.
4. In Supabase, open **Table Editor → tasks → Insert → Import Data from CSV** and select the CSV. Import only the new rows so cards are not duplicated.

Required columns are `game_id`, `title`, `description`, `difficulty`, and `points`. `category` is optional (defaults to `Algemeen`) and `active` is optional (defaults to `true`). Leave out `id` and `created_at`; Supabase fills those in. To take an existing card out of play, set its `active` field to `false` in Table Editor. Do not delete a card that has been claimed unless you also intend to remove its claim and points.

## Website configuration

The project uses Vite, React, and TypeScript. Copy `.env.example` to `.env.local` for local development, then set the values from Supabase **Project Settings → API**:

```dotenv
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
```

Add the same two values to Vercel under **Project → Settings → Environment Variables**. Use only the publishable key in this browser app; never put a Supabase `service_role` or secret key in Vite variables.

Without those variables, the site shows a local demo saved in the current browser. The demo is for previewing the interface; it does not share teams or scores between devices.

## Database tables

- `games`: game name and status.
- `teams`: teams that participate in a game.
- `team_join_codes`: private team codes used by the join screen and QR links.
- `team_members`: links each authenticated player account to one team.
- `tasks`: card text, difficulty, points, category, and whether the card is active.
- `claims`: one winning claim per card, with the points frozen at claim time.

Row Level Security limits players to their game. The database functions check team membership and game status, and a unique constraint on `claims.task_id` makes the first claim win even if two phones submit at the same time. The card list and scoreboard refresh every eight seconds.
