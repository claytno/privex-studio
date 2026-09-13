export function liveChatTimeline(messages = [], joins = []) {
  // The API also deduplicates joins. Deduplicate snapshots again at rendering so
  // an event never creates multiple rows after a poll or realtime invalidation.
  const uniqueJoins = [...new Map(joins.map(join => [join.id, join])).values()];
  return [
    ...messages.map(message => ({ ...message, rowKey: `message:${message.id}`, rowType: 'message', rowTime: message.created_at })),
    ...uniqueJoins.map(join => ({ ...join, rowKey: `join:${join.id}`, rowType: 'join', rowTime: join.joined_at })),
  ].sort((a, b) => (Date.parse(a.rowTime) || 0) - (Date.parse(b.rowTime) || 0));
}
