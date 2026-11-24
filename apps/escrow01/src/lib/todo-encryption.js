/**
 * Whether the todos in one's own lists are encrypted in this build (escrow01).
 *
 * Off. The start dialog says "Todos and lists are not encrypted" because
 * that is true today, and it is to say "encrypted" only once a build makes
 * it true -- the way `budgetInfo.confidential` picks the sentences about the
 * amounts. The todo encryption is being built separately; its PR turns this
 * on, and only together with its tests:
 *
 * - a third browser with a list's address, and the relay, see only sealed
 *   entries;
 * - with "Keep in this browser", the storage inventory holds no todo text in
 *   the clear;
 * - the list behind three words stays readable, and the dialog says so;
 * - after a grant is taken back, new entries are unreadable to that reader
 *   (old ones stay readable: the text must not claim more);
 * - without a passkey (no PRF), what happens to one's own lists is defined
 *   and named in the "without a passkey" link.
 *
 * What switches with it so far: the first screen's sentences on amounts and
 * lists, and the heading of the lists group under "All notices". The clauses
 * under that heading still say "not encrypted"; the same PR rewrites them to
 * what it implements (`consent.clause.readingIsOpen`, `privateList`, `relay`,
 * `delegation`, `storagePersistent`, `consent.keepHint`), and splits the
 * group into "your lists" and "the list behind three words". It also needs
 * the private start list: on main the list a browser starts on is a
 * three-word list, which stays open either way.
 */
export const todosEncrypted = false;
