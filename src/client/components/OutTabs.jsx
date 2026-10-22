import { useEffect, useRef, useState } from 'react';

/* The right column's tab bar, grouped into four dropdowns.
 *
 * Twelve tools as flat tabs is a wall you have to scan; as four short menus it
 * is a strip you can read. Each group is a real dropdown button: click it and
 * its tools open as a menu, pick one and the panel switches. The group holding
 * the active tool is highlighted and shows the tool's name, so the bar still
 * says where you are without showing every tab at once. Counts (shots, console)
 * and the check failure dot ride along inside the menu, and the failure dot is
 * also mirrored onto the group button so a broken check is never hidden. */
const GROUPS = [
  { id: 'measure', label: 'measure', tools: ['check', 'board', 'dashboard', 'shots'] },
  { id: 'make', label: 'make', tools: ['diagram', 'draft', 'assets', 'source'] },
  { id: 'film', label: 'film', tools: ['storyboard', 'video'] },
  { id: 'ship', label: 'ship', tools: ['export', 'publish'] },
  { id: 'system', label: 'system', tools: ['console', 'keys'] },
];

const LABEL = {
  check: 'check', board: 'board', dashboard: 'dashboard', shots: 'shots',
  diagram: 'diagram', draft: 'draft', assets: 'photo', source: 'from source',
  storyboard: 'storyboard', video: 'video',
  export: 'export', publish: 'publish', console: 'console', keys: 'keys',
};

export default function OutTabs({ tab, onPick, shots = [], lines = [], checkResult }) {
  const [open, setOpen] = useState(null);
  const root = useRef(null);

  /* Close on an outside click or Escape. The mousedown handler ignores clicks
     inside the bar, so opening one menu while another is open just moves it. */
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (root.current && !root.current.contains(e.target)) setOpen(null); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(null); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const count = { shots: shots.length, console: lines.length };
  const bad = { check: !!(checkResult && !checkResult.ready) };

  return (
    <div className="tab-groups" ref={root}>
      {GROUPS.map((g) => {
        const active = g.tools.includes(tab);
        return (
          <div
            key={g.id}
            className={'tab-grp' + (active ? ' on' : '') + (open === g.id ? ' open' : '')}
            data-group={g.id}
          >
            <button
              className="tab-grp-btn"
              onClick={() => setOpen((o) => (o === g.id ? null : g.id))}
              aria-haspopup="menu"
              aria-expanded={open === g.id}
            >
              {g.label}
              {active ? <span className="tab-grp-now">{LABEL[tab]}</span> : null}
              {g.tools.some((t) => bad[t]) ? <span className="dot bad" /> : null}
              <span className="caret" aria-hidden="true">▾</span>
            </button>

            {open === g.id ? (
              <div className="tab-menu" role="menu">
                {g.tools.map((t) => (
                  <button
                    key={t}
                    role="menuitem"
                    data-tab={t}
                    className={'tab-item' + (tab === t ? ' on' : '')}
                    onClick={() => { onPick(t); setOpen(null); }}
                  >
                    {LABEL[t]}
                    {count[t] ? <span className="tab-count">{count[t]}</span> : null}
                    {bad[t] ? <span className="dot bad" /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
