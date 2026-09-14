import {describe,expect,it} from 'vitest';
import {createQualificationCardHtml,qualificationCardPositions,type CrewMember} from '@fireops/domain';

const member:CrewMember={
  id:'crew-1',name:'Alex <River>',email:'alex@example.com',phone:'',role:'member',status:'Active',
  credentials:[
    {id:'fft2',name:'Firefighter Type 2',recordType:'Qualification',courseCode:'FFT2',completionDate:'2025-05-01',expirationDate:'2026-12-31'},
    {id:'s130',name:'Firefighter Training',recordType:'Training',courseCode:'S-130',completionDate:'2025-04-01'},
  ],
};

describe('qualification card',()=>{
  it('offers incident qualifications and legacy qualification credentials as card positions',()=>{
    const withLegacy={...member,credentials:[...(member.credentials??[]),{id:'legacy-red-card',name:'Red Card'}]};
    expect(qualificationCardPositions(withLegacy).map(item=>item.id)).toEqual(['fft2','legacy-red-card']);
    expect(qualificationCardPositions({...member,credentials:undefined,credentialName:'Legacy Red Card',credential:{name:'red-card.pdf',type:'application/pdf',dataUrl:'data:application/pdf;base64,test'}})).toHaveLength(1);
  });

  it('renders selected position and escapes employee-provided values',()=>{
    const html=createQualificationCardHtml(member,{employeeName:member.name,companyName:'Fire & Co',companyPhone:'555-0100',homeBase:'North <Base>',primaryQualificationId:'fft2'});
    expect(html).toContain('FFT2');
    expect(html).toContain('Firefighter Type 2');
    expect(html).toContain('Alex &lt;River&gt;');
    expect(html).toContain('Fire &amp; Co');
    expect(html).not.toContain('S-130');
  });
});
