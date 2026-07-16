// Single source of truth for the build version.
//
// Bump MINOR for a feature release, PATCH for fixes. 1.0.0 is reserved for the
// first real public launch — meaning the art direction is settled and the game
// is something you'd actively promote rather than share with friends.
//
// Displayed in the help modal footer so you can always confirm what's actually
// live on dailyladder.app versus what you have locally.

export const VERSION = "0.8.2";

export const CHANGELOG = [
  ["0.8.2", "Fix: 'Next rung' button was white-on-white and unreadable"],
  ["0.8.1", "Clearer sign-in errors (custom SMTP required for non-team emails)"],
  ["0.8.0", "Analytics wired (dormant), version stamp, leaderboard retry button"],
  ["0.7.0", "Accounts, friends, leaderboards, cosmetics; visual polish pass"],
  ["0.6.0", "Realism pass; new guess rules (typed/skip/choices); sheet + console layouts"],
  ["0.5.0", "Full-screen climb stage with six worlds, camera pan, weather"],
  ["0.4.0", "Timer + tiebreaker; ladder scene with climber"],
  ["0.3.0", "Archive mode, practice mode"],
  ["0.2.0", "Typed answers, hidden-theme bonus rung"],
  ["0.1.0", "Initial daily game: 5 rungs, hidden theme, share grid"],
];
