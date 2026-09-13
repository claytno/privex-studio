import { useEffect, useRef, useState } from 'react';
import { initEcho } from "../../renderer/echo.js";

const users = new Map();
// Events only invalidate; authorized HTTP reads remain the source of content.
export default function useLiveRoomEvents(sessionId, refresh, minimumInterval = 3000) {
  const callback = useRef(refresh);
  const [connected, setConnected] = useState(false);
  useEffect(() => { callback.current = refresh; }, [refresh]);
  useEffect(() => {
    if (!sessionId) return;
    const echo = initEcho();
    if (!echo) return;
    const name = `live.${sessionId}`;
    const channel = echo.private(name);
    const connection = echo.connector?.pusher?.connection;
    users.set(name, (users.get(name) || 0) + 1);
    let timer;
    let previous = 0;
    const changed = () => {
      if (timer) return;
      timer = setTimeout(() => { timer = null; previous = Date.now(); callback.current(); }, Math.max(250, minimumInterval - (Date.now() - previous)));
    };
    const state = () => { setConnected(connection?.state === 'connected'); changed(); };
    channel.listen('.live.chat.updated', changed);
    channel.listen('.live.commerce.updated', changed);
    connection?.bind('state_change', state);
    state();
    return () => {
      clearTimeout(timer);
      channel.stopListening('.live.chat.updated', changed);
      channel.stopListening('.live.commerce.updated', changed);
      connection?.unbind('state_change', state);
      const remaining = (users.get(name) || 1) - 1;
      if (remaining === 0) { users.delete(name); echo.leave(name); } else users.set(name, remaining);
    };
  }, [sessionId, minimumInterval]);
  return connected;
}
