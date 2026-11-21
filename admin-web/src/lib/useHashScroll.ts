import { useEffect } from 'react';

/**
 * A link such as /dashboard/approvals#phone-changes lands on that section. The page fills in a little at a time,
 * so the section is looked for until it appears (up to 8 seconds), then scrolled into view and highlighted for a moment.
 */
export function useHashScroll() {
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      const el = document.getElementById(id);
      if (el) {
        window.clearInterval(timer);
        window.setTimeout(() => {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          el.classList.add('hash-flash');
          window.setTimeout(() => el.classList.remove('hash-flash'), 2400);
        }, 250);
      } else if (tries > 40) window.clearInterval(timer);
    }, 200);
    return () => window.clearInterval(timer);
  }, []);
}
