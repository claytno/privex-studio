import { useCallback, useEffect, useState } from 'react';
import api from "../../renderer/adapter.js";

// One in-flight request, cancelled on route changes; hidden tabs stop polling.
export default function useLivePolling(path, interval = 5000) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => { setData(null); setError(''); setLoading(Boolean(path)); }, [path]);
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    const request = async () => {
      if (busy || document.hidden || !path) return;
      busy = true;
      try {
        const response = await api.get(path, { signal: controller.signal, timeout: 15000 });
        if (controller.signal.aborted) return;
        setData(response.data);
        setError('');
      } catch (failure) {
        if (!controller.signal.aborted) {
          if ([401, 403, 404, 410].includes(failure.response?.status)) setData(null);
          setError(failure.response?.data?.message || 'Não foi possível atualizar. Verifique sua conexão e tente novamente.');
        }
      } finally {
        busy = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    request();
    const timer = setInterval(request, interval);
    document.addEventListener('visibilitychange', request);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', request);
    };
  }, [path, interval, revision]);
  return { data, setData, error, loading, refresh };
}
