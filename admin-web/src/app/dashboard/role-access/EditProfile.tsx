'use client';

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { storage } from '@/lib/firebase';
import { setAdminProfile } from '@/lib/functions';
import { setProfileCache } from '@/lib/useUserNames';
import { Avatar } from '@/components/MemberPicker';
import { notify } from '@/lib/notify';
import { tx } from '@/lib/i18n/tr';

/** Change the name and the picture of a person (works for admin accounts that have no member profile yet). */
export default function EditProfile({ userId, name, photoUrl, email, canLogin, onSaved, onClose }: { userId: string; name: string; photoUrl?: string; email?: string; canLogin: boolean; onSaved?: (email: string) => void; onClose: () => void }) {
  const [nm, setNm] = useState(name);
  const [mail, setMail] = useState(email ?? '');
  const [pw, setPw] = useState('');
  const [photo, setPhoto] = useState(photoUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const file = useRef<HTMLInputElement>(null);

  const upload = async (f: File) => {
    setBusy(true); setErr('');
    try {
      const r = storageRef(storage, `profilePhotos/${userId}/photo.jpg`);
      await uploadBytes(r, f, { contentType: f.type || 'image/jpeg' });
      setPhoto(await getDownloadURL(r));
    } catch (e) { setErr(e instanceof Error ? e.message : tx("The picture could not be uploaded.")); } finally { setBusy(false); }
  };
  const save = async () => {
    if (!nm.trim()) { setErr(tx("Write a name.")); return; }
    setBusy(true); setErr('');
    try {
      await setAdminProfile({ userId, displayName: nm.trim(), ...(photo && photo !== photoUrl ? { photoUrl: photo } : {}), ...(canLogin && mail.trim() && mail.trim().toLowerCase() !== (email ?? '').toLowerCase() ? { email: mail.trim() } : {}), ...(canLogin && pw ? { password: pw } : {}) });
      onSaved?.(mail.trim().toLowerCase());
      setProfileCache(userId, { name: nm.trim(), ...(photo ? { photoUrl: photo } : {}) });
      notify('Profile saved', 'success');
      onClose();
    } catch (e) { setErr((e as { message?: string }).message || tx("It could not be saved.")); } finally { setBusy(false); }
  };

  return createPortal(
    <div className="fx-backdrop" role="presentation" style={{ zIndex: 2000 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ra-modal ra-small" role="dialog" aria-modal="true" aria-label={tx("Edit profile")}>
        <header><div><h2>{canLogin ? tx("Edit account") : tx("Edit name and picture")}</h2><p>{canLogin ? tx("Name, picture and sign-in details.") : tx("Shown everywhere in the platform.")}</p></div><button type="button" aria-label={tx("Close")} onClick={onClose}>×</button></header>
        <div className="ra-body">
          <div className="ra-who"><Avatar name={nm || '?'} photoUrl={photo} size={64} />
            <span><button type="button" className="ra-link" style={{ margin: 0 }} onClick={() => file.current?.click()} disabled={busy}>{tx("Choose a picture")}</button><small>{tx("JPG or PNG, a clear face photo works best")}</small></span>
            <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
          </div>
          <div className="ra-new"><label>{tx("Full name")}<input value={nm} onChange={(e) => setNm(e.target.value)} placeholder={tx("Name shown to everyone")} /></label>
            {canLogin && <label>{tx("Sign-in email")}<input type="email" value={mail} onChange={(e) => setMail(e.target.value)} placeholder={tx("name@example.com")} autoComplete="off" /></label>}
            {canLogin && <label>{tx("New password (leave empty to keep it)")}<input type="text" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={tx("At least 8 characters")} autoComplete="new-password" /></label>}
          </div>
          {canLogin && <p className="ra-hint">{tx("The person signs in with the email and password above. Share a new password with them privately.")}</p>}
          {err && <p className="ra-err">{err}</p>}
        </div>
        <footer><span className="ra-sum" /><button type="button" className="ra-ghost" onClick={onClose}>{tx("Cancel")}</button><button type="button" className="ra-go" disabled={busy} onClick={save}>{busy ? tx("Saving…") : tx("Save")}</button></footer>
      </div>
    </div>,
    document.body
  );
}
