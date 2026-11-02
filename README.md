# Japan Budget

Budget-tracker for Nicolai & Alex under udvekslingen i Japan.

- Tast udgifter i ¥ eller kr (live kurs, gemmes pr. post) – enkelt køb eller hele dagen
- Dagligt budget pr. person (start 400 kr), kan ændres i indstillinger
- Pre/post lock-in statistik, buffer, prognose for hele turen inkl. faste udgifter
- Data i Supabase (låst bag en fælles kode), statisk side på GitHub Pages

Opsætning af databasen: kør `supabase.sql` i Supabase SQL Editor. Forbindelsen står i `config.js`.
Test-dato: tilføj `?today=2026-12-01` til URL'en.
