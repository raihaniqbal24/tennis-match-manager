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
- Fixed partners: two players who always play on the same team. They are kept together unless splitting them is the only way to keep playtime even (which happens when only one player can sit out per round, since a pair cannot rest together there); in practice they stay together in roughly 3 out of 4 rounds. Both sit out until each other are available, re-roll and generation move them as a unit, and a pair on court can be replaced with two random bench players. Ignored in singles.

Built with ❤️ and a little help from AI.
