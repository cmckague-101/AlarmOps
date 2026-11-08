import type { CrewMember } from '@fireops/domain';
import { userRoleLabel } from '@fireops/domain';
import { ChevronDown, CircleUserRound, Users } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import './CrewReview.css';

export default function CrewReview({ viewer, crew, onOpenMasterRecord }: { viewer: CrewMember; crew: CrewMember[]; onOpenMasterRecord: (member: CrewMember) => void }) {
  const members = useMemo(
    () => crew.filter((member) => member.id !== viewer.id).sort((a, b) => a.name.localeCompare(b.name)),
    [crew, viewer.id],
  );
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const openRecord = (member: CrewMember) => {
    setOpen(false);
    onOpenMasterRecord(member);
  };

  return <section className="crew-records" aria-labelledby="crew-records-heading">
    <header className="crew-records-heading">
      <span className="crew-records-mark" aria-hidden="true"><Users /></span>
      <div>
        <h2 id="crew-records-heading">Crew records</h2>
        <p>Open your master record or review another crew member’s.</p>
      </div>
    </header>
    <div className="crew-records-picker" ref={rootRef}>
      <button
        type="button"
        className={`crew-records-trigger${open ? ' open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="crew-records-trigger-icon" aria-hidden="true"><Users /></span>
        <span className="crew-records-trigger-copy">
          <b>Select a record</b>
          <small>My records + {members.length} {members.length === 1 ? 'crew member' : 'crew members'}</small>
        </span>
        <ChevronDown aria-hidden="true" />
      </button>
      {open && <ul className="crew-records-menu" id={listId} role="listbox" aria-label="Qualification records">
        <li role="option">
          <button type="button" className="crew-records-self" onClick={() => openRecord(viewer)}>
            <span className="crew-records-avatar self" aria-hidden="true"><CircleUserRound /></span>
            <span className="crew-records-member-copy">
              <b>My records</b>
              <small>{viewer.name} · {userRoleLabel(viewer.role)}</small>
            </span>
          </button>
        </li>
        {members.length > 0 && <li className="crew-records-divider" aria-hidden="true">Crew</li>}
        {members.map((member) => (
          <li key={member.id} role="option">
            <button type="button" onClick={() => openRecord(member)}>
              <span className="crew-records-avatar" aria-hidden="true">{member.name.slice(0, 1).toUpperCase()}</span>
              <span className="crew-records-member-copy">
                <b>{member.name}</b>
                <small>{userRoleLabel(member.role)}{member.status === 'Invited' ? ' · Invited' : ''}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>}
    </div>
  </section>;
}
