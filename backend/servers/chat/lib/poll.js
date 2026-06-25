/**
 * Poll vote machinery for the chat server.
 *
 * Polls are an attachment type — a message with `attachment.type === 'poll'`
 * carries the question + option list + multipleChoice flag. Votes live in:
 *
 *   chatGroups/{sectionId}/messages/{msgId}/votes/{userId}
 *     { tenantId, optionIds: string[], votedAt: Timestamp }
 *
 * This module exports the tally computation used by both the GET (read-only
 * view) and POST (cast/retract) poll endpoints so the tallying logic lives in
 * exactly one place.
 *
 * Exports:
 *   - computeTallies(msgRef, att, tenantId)
 *       Read all vote docs for `msgRef` (tenant-filtered) and return
 *       { tallies, totalVoters }.
 */

/**
 * Scan the `votes` subcollection of `msgRef` (filtered to `tenantId`) and
 * return a tally map keyed by option id plus the total voter count.
 *
 * @param {FirebaseFirestore.DocumentReference} msgRef
 * @param {{ poll: { options: { id: string }[] } }} att  message attachment
 * @param {string} tenantId
 * @returns {Promise<{ tallies: Record<string, number>, totalVoters: number }>}
 */
async function computeTallies(msgRef, att, tenantId) {
  const votesSnap = await msgRef
    .collection('votes')
    .where('tenantId', '==', tenantId)
    .get();

  const tallies = Object.fromEntries(
    (att.poll.options || []).map((o) => [o.id, 0])
  );
  let totalVoters = 0;

  votesSnap.forEach((v) => {
    const ids = Array.isArray(v.get('optionIds')) ? v.get('optionIds') : [];
    for (const id of ids) {
      if (id in tallies) tallies[id] += 1;
    }
    totalVoters += 1;
  });

  return { tallies, totalVoters };
}

module.exports = { computeTallies };
