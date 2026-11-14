import { useCallback, useEffect, useRef, useState } from 'react';

const URL = 'ws://localhost:8787';

export function useTracker() {
  const [tracking, setTracking] = useState({ yaw: 0, pitch: 0, roll: 0, rate: 0, staleMs: 0, connected: false });
  const [bridge, setBridge] = useState({ online: false, port: '', frames: 0, sent: 0, badChecksum: 0 });
  const [events, setEvents] = useState([]);
  const [config, setConfig] = useState(null);
  const [profiles, setProfiles] = useState([]);
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
        switch (msg.type) {
          case 'tracking':
            setTracking(msg);
            break;
          case 'status':
            setBridge((b) => ({ ...b, ...msg, online: true }));
            break;
          case 'config':
            setConfig(msg.cfg);
            break;
          case 'profiles':
            setProfiles(msg.names);
            break;
          case 'device':
          case 'event':
            setEvents((ev) => [msg.text, ...ev].slice(0, 8));
            break;
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

  const send = useCallback((obj) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }, []);

  const actions = {
    recenter: () => send({ type: 'command', name: 'recenter' }),
    calibrate: () => send({ type: 'command', name: 'calibrate' }),
    setConfig: (values) => send({ type: 'setConfig', values }),
    resetDefaults: () => send({ type: 'resetDefaults' }),
    saveProfile: (name) => send({ type: 'saveProfile', name }),
    loadProfile: (name) => send({ type: 'loadProfile', name }),
  };

  return { tracking, bridge, events, config, profiles, actions };
}
