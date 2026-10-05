'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const ACCESS_STORAGE_KEY = 'collaboragent.access-code';

/** The deployment's shared access code, remembered in this browser only. */
export function useAccessCode() {
  const [accessCode, setAccessCode] = useState('');
  const accessCodeRef = useRef('');
  useEffect(() => {
    try {
      const saved = localStorage.getItem(ACCESS_STORAGE_KEY) ?? '';
      accessCodeRef.current = saved;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after hydration.
      if (saved) setAccessCode(saved);
    } catch { /* storage unavailable: the code is requested again on 401 */ }
  }, []);
  const saveAccessCode = useCallback((code: string) => {
    accessCodeRef.current = code;
    setAccessCode(code);
    try {
      if (code) localStorage.setItem(ACCESS_STORAGE_KEY, code); else localStorage.removeItem(ACCESS_STORAGE_KEY);
    } catch { /* keep the code for this session only */ }
  }, []);
  return { accessCode, accessCodeRef, saveAccessCode };
}
