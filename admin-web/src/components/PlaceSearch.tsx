'use client';

import { useEffect, useRef, useState } from 'react';
import { searchPlaces, type PlaceHit } from '@/lib/googleMaps';
import { tx } from '@/lib/i18n/tr';

/** Search box with live suggestions: results appear while typing and a click on one selects it. No search button needed. */
export default function PlaceSearch({ onPick, near, placeholder }: { onPick: (p: PlaceHit) => void; near?: string; placeholder?: string }) {
  const [text, setText] = useState('');
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [empty, setEmpty] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const skip = useRef(false);

  useEffect(() => {
    if (skip.current) { skip.current = false; return; }
    const t = text.trim();
    if (t.length < 3) { setHits([]); setEmpty(false); setBusy(false); return; }
    const mine = ++seq.current;
    setBusy(true);
    const timer = setTimeout(async () => {
      const r = await searchPlaces(t, near);
      if (mine !== seq.current) return;
      setHits(r);
      setEmpty(r.length === 0);
      setActive(-1);
      setBusy(false);
      setOpen(true);
    }, 350);
    return () => clearTimeout(timer);
  }, [text, near]);

  useEffect(() => {
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, []);

  function pick(h: PlaceHit) {
    skip.current = true;
    setText(h.name && !h.address.toLowerCase().startsWith(h.name.toLowerCase()) ? `${h.name}, ${h.address}` : h.address);
    setHits([]);
    setOpen(false);
    seq.current++;
    onPick(h.name && !h.address.toLowerCase().startsWith(h.name.toLowerCase()) ? { ...h, address: `${h.name}, ${h.address}` } : h);
  }

  return (
    <div className="ps" ref={box}>
      <div className="ps-field">
        <span className="ps-ico" aria-hidden>⌕</span>
        <input
          value={text}
          placeholder={placeholder ?? tx("Type a neighbourhood, street or landmark")}
          onFocus={() => hits.length && setOpen(true)}
          onChange={(e) => { setText(e.target.value); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(hits.length - 1, a + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            else if (e.key === 'Enter') { e.preventDefault(); const h = hits[active >= 0 ? active : 0]; if (h) pick(h); }
            else if (e.key === 'Escape') setOpen(false);
          }}
        />
        {busy && <span className="ps-spin" aria-label={tx("Searching")} />}
        {text && !busy && <button type="button" className="ps-x" aria-label={tx("Clear")} onClick={() => { setText(''); setHits([]); }}>×</button>}
      </div>
      {open && (hits.length > 0 || (empty && !busy)) && (
        <ul className="ps-list" role="listbox">
          {hits.map((h, i) => (
            <li key={`${h.lat},${h.lng},${i}`} role="option" aria-selected={i === active} className={i === active ? 'on' : ''} onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); pick(h); }}>
              <span className="ps-pin" aria-hidden>📍</span>
              <span><strong>{h.name ?? h.address.split(',')[0]}</strong><small>{h.name ? h.address : h.address.split(',').slice(1).join(',').trim()}</small></span>
            </li>
          ))}
          {hits.length === 0 && <li className="none">{tx("No place found. Add the city or country, for example “Almadies, Dakar”.")}</li>}
        </ul>
      )}
    </div>
  );
}
