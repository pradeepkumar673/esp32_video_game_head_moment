import { useEffect, useRef, useState } from 'react';

const URL = 'ws://localhost:8787';

export function useTracker() {
  const [tracking, setTracking] = useState({ yaw: 0, pitch: 0, roll: 0, rate: 0, staleMs: 0, connected: false });
  const [bridge, setBridge] = useState({ online: false, port: '', frames: 0, sent: 0, badChecksum: 0 });
  const [events, setEvents] = useState([]);
  const wsRef = useRef(null);

  useEffect(() => {
    let closed = false;
    let retry = null;

    function connect() {
      const ws = new WebSocket(URL);
      wsRef.current = ws;

      ws.onopen = () => setBridge((b) => ({ ...b, online: true }));

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'tracking') {
          setTracking(msg);
        } else if (msg.type === 'status') {
          setBridge((b) => ({ ...b, ...msg, online: true }));
        } else if (msg.type === 'device' || msg.type === 'event') {
          setEvents((ev) => [msg.text, ...ev].slice(0, 8));
        }
      };

      ws.onclose = () => {
        setBridge((b) => ({ ...b, online: false }));
        setTracking((t) => ({ ...t, connected: false }));
        if (!closed) retry = setTimeout(connect, 1500);
      };
    }

    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const recenter = () => {
    if (wsRef.current && wsRef.current.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'command', name: 'recenter' }));
    }
  };

  return { tracking, bridge, events, recenter };
}

