package com.checkup.pharmacy.modules.user;

/**
 * The only two fields the authentication filter actually needs from a user row.
 *
 * <p>Exists because that filter runs on <b>every authenticated request</b> and was
 * loading the entire {@code User} entity to read two values — dragging
 * {@code passwordHash}, {@code passwordResetToken}, email, phone and name across
 * the wire and into the persistence context each time.
 *
 * <p>Two reasons that matters beyond raw bytes:
 * <ul>
 *   <li><b>Load.</b> Authentication is the most-executed query in the system. With
 *       a five-connection pool, its cost sets a ceiling on everything else.</li>
 *   <li><b>Exposure.</b> Password hashes and live reset tokens were being read into
 *       application memory on every request that merely needed "is this user still
 *       active?". Not a vulnerability on its own, but it puts the most sensitive
 *       columns in the hottest path for no benefit — they are exactly the values
 *       you do not want in a heap dump.</li>
 * </ul>
 */
public record AuthStatus(boolean active, int tokenVersion) {
}
