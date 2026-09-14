import type { CredentialRecordType, CrewMember, QualificationCardRequest } from '@fireops/domain';
import { crewCredentials } from '@fireops/domain';
import { useEffect, useMemo, useState } from 'react';
import { loadCompanyQualificationCardRequests } from './qualificationCardStore';
import './CrewReview.css';

const recordTypes: CredentialRecordType[] = ['Training', 'Qualification', 'License', 'Task Book', 'Medical'];
const date = (value?: string) => value ? new Date(`${value}T12:00:00`).toLocaleDateString() : 'Not recorded';

export default function CrewReview({ crew, companyId }: { crew: CrewMember[]; companyId?: string }) {
  const members = useMemo(() => crew.filter((member) => member.role === 'member').sort((a, b) => a.name.localeCompare(b.name)), [crew]);
  const [selectedId, setSelectedId] = useState('');
  const [requests, setRequests] = useState<QualificationCardRequest[]>([]);
  const [cardError, setCardError] = useState('');
  const member = members.find((item) => item.id === selectedId);

  useEffect(() => {
    if (!companyId) return;
    let active = true;
    loadCompanyQualificationCardRequests(companyId)
      .then((next) => { if (active) setRequests(next); })
      .catch((error: unknown) => { if (active) setCardError(error instanceof Error ? error.message : 'Qualification card status unavailable.'); });
    return () => { active = false; };
  }, [companyId, members]);

  const credentials = member ? crewCredentials(member) : [];
  const approvedCard = member ? requests.find((request) => request.crewUserId === member.id && request.status === 'approved') : undefined;

  return <div className="crew-review">
    <label className="crew-review-select">
      <b>Crew Review</b>
      <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
        <option value="">Select crew member</option>
        {members.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label>
    {member && <div className="crew-review-details">
      <header><div><h3>{member.name}</h3><p>{member.email} · {member.phone}</p></div><strong className={approvedCard ? 'complete' : ''}>{approvedCard ? 'Qualification card completed' : 'No completed qualification card'}</strong></header>
      {cardError && <p className="crew-review-error">{cardError}</p>}
      <div className="crew-review-grid">
        {recordTypes.map((type) => {
          const records = credentials.filter((credential) => (credential.recordType ?? 'Qualification') === type);
          return <section key={type}><h4>{type}</h4>{records.length ? records.map((record) => <article key={record.id}><b>{record.name}</b><span>Course: {record.courseCode || 'Not recorded'}</span><span>Completed: {date(record.completionDate)}</span><span>Expires: {date(record.expirationDate)}</span><span>Provider: {record.provider || 'Not recorded'}</span><span>File: {record.file?.name || 'None'}</span></article>) : <p>No records</p>}</section>;
        })}
        <section><h4>Experience</h4>{member.experiences?.length ? member.experiences.map((experience) => <article key={experience.id}><b>{experience.incident}</b><span>Position: {experience.position}</span><span>Days: {experience.days}</span><span>File: {experience.file?.name || 'None'}</span></article>) : <p>No experience records</p>}</section>
        <section><h4>Annual records</h4>{member.annualRecord ? <article><span>RT-130 completion: {date(member.annualRecord.rt130CompletionDate)}</span><span>RT-130 currency: {date(member.annualRecord.rt130CurrencyDate)}</span><span>WCT completion: {date(member.annualRecord.wctCompletionDate)}</span><span>WCT currency: {date(member.annualRecord.wctCurrencyDate)}</span></article> : <p>No annual record</p>}</section>
      </div>
    </div>}
  </div>;
}
