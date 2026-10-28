// What the Teamly key really holds: Teamly Dollars from the Teamly API, the same wallet as on the site. No number is
// made up: while Teamly hasn't answered the panel shows "…", and a key that isn't a Teamly key has no Teamly Dollars.
// state: real (a balance from Teamly) · checking · offline · error (Teamly answered, but not with a balance) ·
// rejected (Teamly said no to the key) · none (not a Teamly key)
export function moneyOf(S) {
  const k = S?.key ?? {};
  const w = S?.wallet;
  if (k.reason === "demo") return { state: "none", real: false, balance: 0, held: 0 };
  // a key Teamly said no to holds no money here, whatever balance was shown before
  if (k.verified === false) return { state: "rejected", real: false, balance: null, held: 0 };
  if (w && typeof w.balance === "number") {
    return { state: "real", real: true, balance: w.balance, held: Number(w.held) || 0, topup: w.topup ?? null, at: w.at ?? null };
  }
  if (k.verified === true && S?.walletError) return { state: "error", real: false, balance: null, held: 0 };
  return { state: k.reason === "offline" || k.reason === "server" ? "offline" : "checking", real: false, balance: null, held: 0 };
}
