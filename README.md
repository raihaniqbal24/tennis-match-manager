# Tennis Match Manager

Static browser app for social tennis rotation management.

Features:

- Independent court cycles: complete and refill one court without waiting for other courts.
- Match history grouped by court.
- Player away/home status.
- Match-count balancing, targeting an equal count and otherwise a spread of 1 where possible.
- Waiting streak tracking with warning at 2 and alert at 4.
- Small scheduling reward for players who arrived earlier.
- Strong no-repeat-partner preference for doubles.
- Custom court names with Court 1, Court 2 defaults.
- Tabs for Setup & Players, Overview, and Current Round & History.
- LocalStorage persistence and session reset.
- Two-stage match flow: generated matches sit in a "Reviewing" state until confirmed, so nothing is committed to match counts or waiting streaks until you start the match.
- Re-roll a reviewed match for a random line-up, always different from the one just rejected.
- Swap any player in a reviewed match by clicking their name and picking a replacement.
- Swap pairing to cycle a doubles match through its three possible team splits.

Planned:

- Fixed partners (two players who always play on the same team). See the FIXED-PARTNER SEAMS comment at the top of `js/scheduler.js` for the four hook points.

Built with ❤️ and a little help from AI.
