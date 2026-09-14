import {createQualificationCardHtml,qualificationCardPositionLabel,qualificationCardPositions,type CompanyInfo,type CrewMember,type QualificationCardInput} from '@fireops/domain';
import {ArrowLeft,Download,ImagePlus,ShieldAlert,Trash2} from 'lucide-react';
import {useMemo,useRef,useState} from 'react';
import './QualificationCardPage.css';

export default function QualificationCardPage({member,company,onBack}:{member?:CrewMember;company:CompanyInfo;onBack:()=>void}){
  const positions=useMemo(()=>qualificationCardPositions(member),[member]);
  const [companyPhone,setCompanyPhone]=useState('');
  const [homeBase,setHomeBase]=useState('');
  const [primaryQualificationId,setPrimaryQualificationId]=useState(()=>positions[0]?.id??'');
  const [photoDataUrl,setPhotoDataUrl]=useState('');
  const [photoName,setPhotoName]=useState('');
  const [error,setError]=useState('');
  const inputRef=useRef<HTMLInputElement>(null);
  const input:QualificationCardInput={employeeName:member?.name??'',companyName:company.name,companyPhone,homeBase,primaryQualificationId,...(photoDataUrl?{photoDataUrl}:{})};
  const html=member?createQualificationCardHtml(member,input):'';
  const valid=Boolean(member&&primaryQualificationId&&companyPhone.trim()&&homeBase.trim()&&photoDataUrl);

  const choosePhoto=(file?:File)=>{
    setError('');
    if(!file)return;
    if(!file.type.startsWith('image/')){setError('Choose an image file.');return}
    if(file.size>8*1024*1024){setError('Photo must be 8 MB or smaller.');return}
    const reader=new FileReader();
    reader.onerror=()=>setError('Photo could not be read. Choose another image.');
    reader.onload=()=>{setPhotoDataUrl(String(reader.result));setPhotoName(file.name)};
    reader.readAsDataURL(file);
  };
  const savePdf=()=>{
    if(!member||!valid)return;
    const frame=document.createElement('iframe');
    frame.style.cssText='position:fixed;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(frame);
    const target=frame.contentDocument;
    if(!target){frame.remove();return}
    target.open();target.write(html);target.close();
    window.setTimeout(()=>{const printWindow=frame.contentWindow;if(!printWindow){frame.remove();return}const cleanup=()=>frame.remove();printWindow.addEventListener('afterprint',cleanup,{once:true});printWindow.focus();printWindow.print();window.setTimeout(cleanup,60_000)},250);
  };

  return <div className="page qualification-card-page">
    <button className="qualification-back" onClick={onBack}><ArrowLeft/> Back to qualifications</button>
    <div className="page-heading"><div><h1>Build qualification card</h1><p>Complete card details, review live preview, then prepare PDF.</p></div></div>
    {!member?<div className="qualification-card-empty"><ShieldAlert/><h2>Crew record not found</h2><p>Your employee information is unavailable.</p></div>:<div className="qualification-card-layout">
      <form className="qualification-card-form" onSubmit={event=>{event.preventDefault();savePdf()}}>
        <label><span>Employee name</span><input value={member.name} readOnly aria-readonly="true"/></label>
        <label><span>Primary qualified position <b>*</b></span><select required value={primaryQualificationId} onChange={event=>setPrimaryQualificationId(event.target.value)}><option value="">Select qualification</option>{positions.map(position=><option key={position.id} value={position.id}>{qualificationCardPositionLabel(position)}</option>)}</select>{!positions.length&&<small>Add an Incident Qualification credential before building card.</small>}</label>
        <label><span>Company phone number <b>*</b></span><input type="tel" required maxLength={40} value={companyPhone} onChange={event=>setCompanyPhone(event.target.value)} placeholder="(555) 555-0123"/></label>
        <label><span>Home base <b>*</b></span><input required maxLength={160} value={homeBase} onChange={event=>setHomeBase(event.target.value)} placeholder="Base or home unit"/></label>
        <label><span>Company</span><input value={company.name} readOnly aria-readonly="true"/></label>
        <div className="qualification-photo-field"><span>Employee photo <b>*</b></span><input ref={inputRef} className="sr-only" type="file" accept="image/*" onChange={event=>choosePhoto(event.target.files?.[0])}/><button type="button" className="qualification-photo-picker" onClick={()=>inputRef.current?.click()}><ImagePlus/>{photoName||'Choose photo'}</button>{photoDataUrl&&<button type="button" className="qualification-photo-remove" onClick={()=>{setPhotoDataUrl('');setPhotoName('');if(inputRef.current)inputRef.current.value=''}}><Trash2/> Remove photo</button>}</div>
        {error&&<div className="form-submit-error" role="alert">{error}</div>}
        <button className="primary qualification-card-save" disabled={!valid}><Download/> Prepare PDF</button>
        <p className="qualification-card-hint">Print dialog opens with card formatted for landscape letter paper. Choose “Save as PDF”.</p>
      </form>
      <section className="qualification-card-preview" aria-labelledby="card-preview-title"><header><div><h2 id="card-preview-title">Card preview</h2><p>Updates as fields change.</p></div><span>Landscape</span></header><div className="qualification-card-frame"><iframe title="Incident qualification card preview" srcDoc={html}/></div></section>
    </div>}
  </div>;
}
