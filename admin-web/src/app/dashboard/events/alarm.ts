'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const KEY = 'sv-alarm-sound';
const read = () => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } };

/**
 * A sound for conflicts. A siren plays when a new conflict appears and repeats every 20 seconds until it is
 * solved or silenced; a single soft tone plays for a new overrun. The browser tab title flashes while a
 * conflict is open. Browsers only allow sound after the person has clicked somewhere on the page, so the
 * banner shows a button when the sound is still blocked.
 */
export function useAlarm(conflictKeys: string[], softKeys: string[]) {
  const [on, setOn] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [silencedUntil, setSilencedUntil] = useState(0);
  const ctx = useRef<AudioContext | null>(null);
  const seenHard = useRef<Set<string>>(new Set());
  const seenSoft = useRef<Set<string>>(new Set());

  useEffect(() => { setOn(read()); }, []);

  const audio = useCallback((): AudioContext | null => {
    try {
      if (!ctx.current) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return null;
        ctx.current = new AC();
      }
      return ctx.current;
    } catch { return null; }
  }, []);

  const tone = useCallback((c: AudioContext, freq: number, start: number, len: number, vol: number) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, c.currentTime + start);
    g.gain.exponentialRampToValueAtTime(vol, c.currentTime + start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + len);
    o.connect(g); g.connect(c.destination);
    o.start(c.currentTime + start);
    o.stop(c.currentTime + start + len + 0.05);
  }, []);

  const play = useCallback((urgent: boolean) => {
    const c = audio();
    if (!c) return;
    const go = () => {
      if (urgent) for (let i = 0; i < 4; i++) { tone(c, 960, i * 0.5, 0.22, 0.25); tone(c, 640, i * 0.5 + 0.25, 0.22, 0.25); }
      else tone(c, 520, 0, 0.25, 0.15);
    };
    if (c.state === 'suspended') { c.resume().then(go).catch(() => setBlocked(true)); setTimeout(() => { if (c.state === 'suspended') setBlocked(true); }, 400); } else { go(); setBlocked(false); }
  }, [audio, tone]);

  // any click on the page unlocks the sound
  useEffect(() => {
    const unlock = () => { const c = audio(); if (c && c.state === 'suspended') c.resume().then(() => setBlocked(false)).catch(() => undefined); };
    document.addEventListener('click', unlock);
    return () => document.removeEventListener('click', unlock);
  }, [audio]);

  const hardId = conflictKeys.join('|');
  const softId = softKeys.join('|');
  useEffect(() => {
    const now = new Set(conflictKeys);
    const fresh = conflictKeys.filter((k) => !seenHard.current.has(k));
    seenHard.current = now;
    if (fresh.length && on) { setSilencedUntil(0); play(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hardId, on]);
  useEffect(() => {
    const fresh = softKeys.filter((k) => !seenSoft.current.has(k));
    seenSoft.current = new Set(softKeys);
    if (fresh.length && on && conflictKeys.length === 0) play(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [softId, on]);

  useEffect(() => {
    if (!on || conflictKeys.length === 0) return;
    const h = window.setInterval(() => { if (Date.now() >= silencedUntil) play(true); }, 20000);
    return () => window.clearInterval(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hardId, on, silencedUntil]);

  useEffect(() => {
    if (conflictKeys.length === 0) return;
    const base = document.title;
    let flip = false;
    const h = window.setInterval(() => { flip = !flip; document.title = flip ? `CONFLICT (${conflictKeys.length}) - act now` : base; }, 1000);
    return () => { window.clearInterval(h); document.title = base; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hardId]);

  return {
    on,
    blocked: blocked && on,
    silenced: Date.now() < silencedUntil,
    toggle: () => { const v = !on; setOn(v); try { localStorage.setItem(KEY, v ? 'on' : 'off'); } catch { /* ignore */ } if (v) play(false); },
    silence: () => setSilencedUntil(Date.now() + 5 * 60000),
    test: () => play(true),
  };
}
