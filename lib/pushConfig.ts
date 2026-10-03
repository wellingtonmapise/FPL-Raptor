/**
 * Web Push settings shared by the browser and server.
 *
 * The public key is meant to be public: browsers use it to check that pushes
 * really come from this app. Its private half lives only in the
 * VAPID_PRIVATE_KEY secret (Vercel and GitHub). If you ever replace the pair,
 * set NEXT_PUBLIC_VAPID_PUBLIC_KEY to the new public key.
 */
export const VAPID_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ??
  "BH_A1Ld8PgGhQrvLcY8GhqpfKEFayFnxGg2oy-BjEeQ59LVmY7MSWjb8Gnv5FytPA7y8NlTrIN9NNjzb5uMJEWU";

/** Contact for the push services (Apple, Google, Mozilla): the site's address. */
export const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "https://fpl-raptor.vercel.app";

export const ALERT_TYPES = [
  { id: "deadline_24h", label: "Deadline reminder, 24 hours before" },
  { id: "deadline_1h", label: "Deadline reminder, 1 hour before" },
  { id: "player_flag", label: "Injury and availability news for your players" },
  { id: "price_change", label: "Price changes for your players" },
] as const;

export type AlertType = (typeof ALERT_TYPES)[number]["id"];
