import { useEffect, useState } from 'react';
import { ArrowDown, BellRing, Boxes, Check, Download, Gauge, GraduationCap, ListOrdered, Mail, MapPinned, MessageSquareText, Phone, ReceiptText, Smartphone, Truck, Users } from 'lucide-react';
import { supabase } from './supabase';
import './auth.css';

export default function FleetLogin({onDemo}:{onDemo:()=>void}){
  useEffect(()=>{
    // The page renders after load, so the browser can't jump to a section link on its own.
    const target=window.location.hash.slice(1);
    if(target)document.getElementById(target)?.scrollIntoView();
    // Match the browser bar to the dark hero while the landing page is shown.
    const themeColor=document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const previousThemeColor=themeColor?.content;
    if(themeColor)themeColor.content='#101815';
    const previousTitle=document.title;
    document.title='FireOps | Crew, fleet and incident operations for wildland fire';
    return()=>{if(themeColor&&previousThemeColor)themeColor.content=previousThemeColor;document.title=previousTitle};
  },[]);
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [resetMode,setResetMode]=useState(false);
  const [sentMethod,setSentMethod]=useState<'reset'|'magic'|null>(null);
  const submit=async(event:React.FormEvent)=>{
    event.preventDefault();
    if(!supabase)return;
    setBusy(true);setError('');
    try{
      const {error:signInError}=await supabase.auth.signInWithPassword({email:email.trim(),password});
      if(signInError)setError(signInError.message);
    }catch{
      setError('FireOps could not be reached. Check your connection and try again.');
    }finally{setBusy(false)}
  };
  const requestEmail=async(event:React.FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    if(!supabase)return;
    const submitter=(event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement|null;
    const method=submitter?.value==='magic'?'magic':'reset';
    setBusy(true);setError('');
    try{
      const {error:requestError}=method==='magic'
        ? await supabase.auth.signInWithOtp({email:email.trim(),options:{shouldCreateUser:false,emailRedirectTo:new URL('/',window.location.origin).toString()}})
        : await supabase.auth.resetPasswordForEmail(email.trim(),{redirectTo:new URL('/reset-password',window.location.origin).toString()});
      // An unknown email is not an error worth showing, so the page never reveals which accounts exist.
      if(requestError&&requestError.status!==400&&requestError.status!==422)setError(requestError.status===429?'Too many requests. Wait a minute, then try again.':requestError.message);
      else setSentMethod(method);
    }catch{
      setError('FireOps could not be reached. Check your connection and try again.');
    }finally{setBusy(false)}
  };
  if(resetMode)return <div className="admin-auth"><form onSubmit={requestEmail}><h1>Reset your password</h1>{sentMethod?<div className="admin-success" role="status">If an account exists for {email.trim()}, {sentMethod==='magic'?'a secure sign-in link':'a password reset link'} is on its way. Check your inbox and spam folder.</div>:<><p>Enter your account email. Reset your password or receive a secure link to sign in without changing it.</p><input type="email" autoComplete="email" aria-label="Email" placeholder="Email" required value={email} onChange={event=>setEmail(event.target.value)}/><button type="submit" value="reset" disabled={busy}>{busy?'Sending...':'Send reset link'}</button><button type="submit" value="magic" className="admin-secondary" disabled={busy}>Email me a sign-in link</button>{error&&<div className="admin-error" role="alert">{error}</div>}</>}<button type="button" className="admin-text-action" onClick={()=>{setResetMode(false);setSentMethod(null)}}>Back to sign in</button></form></div>;
  return <div className="admin-auth admin-login-page">
    <main>
      <section className="login-hero" aria-labelledby="login-title">
        <div className="login-logo-wrap"><img className="login-hero-logo" src="/fireops-wordmark-440.webp" width="440" height="154" alt="FireOps"/><nav aria-label="Landing page"><a href="#features">Features</a><a href="#pricing">Pricing</a><a href="#contact">Contact</a><a className="login-nav-signin" href="#sign-in">Sign in</a></nav></div>
        <div className="login-intro">
          <p className="login-eyebrow">Wildland operations, connected</p>
          <h1 id="login-title">Keep your crew ready. Keep operations moving.</h1>
          <p className="login-lede">FireOps brings people, equipment, training, and field intelligence into one clear operational picture.</p>
          <a className="login-discover" href="#features">See what FireOps covers <ArrowDown aria-hidden="true"/></a>
        </div>

        <form className="login-form" id="sign-in" onSubmit={submit} aria-labelledby="login-form-title" aria-busy={busy}>
          <div className="login-form-heading">
            <span>Secure workspace</span>
            <h2 id="login-form-title">Welcome back</h2>
            <p>Sign in to your FireOps account.</p>
          </div>
          <div className="login-field">
            <label htmlFor="login-email">Work email</label>
            <input id="login-email" type="email" autoComplete="email" placeholder="name@company.com" required value={email} onChange={event=>setEmail(event.target.value)}/>
          </div>
          <div className="login-field">
            <label htmlFor="login-password">Password</label>
            <input id="login-password" type="password" autoComplete="current-password" placeholder="Enter your password" required value={password} onChange={event=>setPassword(event.target.value)}/>
            <button type="button" className="admin-text-action admin-forgot-password" onClick={()=>{setResetMode(true);setError('')}}>Forgot password?</button>
          </div>
          {error&&<div className="admin-error" role="alert">{error}</div>}
          <button className="login-submit" disabled={busy}>{busy?'Signing in...':'Sign in to FireOps'}</button>
          <div className="login-demo-divider"><span>or</span></div>
          <button type="button" className="login-demo" disabled={busy} onClick={onDemo}><Gauge aria-hidden="true"/> Explore demo</button>
          <p className="login-demo-note">No account required. Changes disappear when demo ends.</p>
        </form>
      </section>

      <section className="login-features" id="features" aria-labelledby="features-title">
        <div className="login-section-heading">
          <p className="login-section-kicker">Inside FireOps</p>
          <h2 id="features-title">One view of your whole operation.</h2>
          <p>Crew readiness, fleet inspections, incident assignments, and VIPR dispatch lists stay in one company workspace.</p>
        </div>
        <div className="login-feature-list">
          <article className="login-feature-card login-feature-card--dashboard">
            <div className="login-feature-copy"><span><Gauge aria-hidden="true"/> Dashboard</span><h3>Readiness at a glance</h3><p>See fleet blockers and recent company activity as soon as you sign in.</p></div>
            <figure><img src="/landing/dashboard.webp" width="1305" height="1205" loading="lazy" decoding="async" alt="FireOps dashboard showing fleet readiness, issues, and recent actions"/></figure>
          </article>
          <article className="login-feature-card login-feature-card--operations">
            <div className="login-feature-copy"><span><MapPinned aria-hidden="true"/> Operations</span><h3>Active fires on one map</h3><p>Review NIFC incidents by location, then connect crews and vehicles to assignments.</p></div>
            <figure><img src="/landing/operations.webp" width="1600" height="996" loading="lazy" decoding="async" alt="FireOps operations map showing active wildfire incidents across the United States"/></figure>
          </article>
          <article className="login-feature-card">
            <div className="login-feature-copy">
              <span><Users aria-hidden="true"/> Crew management</span>
              <h3>Know who’s ready to deploy</h3>
              <p>Keep personnel, roles, qualifications, and resource assignments connected to your operation.</p>
              <ul className="login-feature-highlights">
                <li><Check aria-hidden="true"/> Crew profiles and company roles</li>
                <li><Check aria-hidden="true"/> Qualifications and certificates</li>
                <li><Check aria-hidden="true"/> Crew-to-resource assignments</li>
              </ul>
            </div>
          </article>
          <article className="login-feature-card">
            <div className="login-feature-copy">
              <span><ListOrdered aria-hidden="true"/> VIPR DPLs</span>
              <h3>See where resources rank</h3>
              <p>Browse USFS VIPR dispatch priority lists with award rates matched by VIN.</p>
              <ul className="login-feature-highlights">
                <li><Check aria-hidden="true"/> Filter by geographic area and dispatch center</li>
                <li><Check aria-hidden="true"/> Review resource rankings and daily rates</li>
                <li><Check aria-hidden="true"/> Verify records against official USFS sources</li>
              </ul>
            </div>
          </article>
          <article className="login-feature-card login-feature-card--fleet">
            <div className="login-feature-copy"><span><Truck aria-hidden="true"/> Fleet</span><h3>Know what can roll</h3><p>Review vehicle inspections, track maintenance issues and repair history, and keep unit status, assignments, photos, and records together.</p></div>
            <figure><img src="/landing/fleet.webp" width="874" height="1183" loading="lazy" decoding="async" alt="FireOps fleet screen showing ready vehicles and current issues"/></figure>
          </article>
          <article className="login-feature-card login-feature-card--training">
            <div className="login-feature-copy"><span><GraduationCap aria-hidden="true"/> Training</span><h3>Keep qualifications moving</h3><p>Publish courses, monitor capacity, and manage crew registration.</p></div>
            <figure><img src="/landing/training.webp" width="1448" height="1086" loading="lazy" decoding="async" alt="FireOps training screen showing scheduled courses and registration counts"/></figure>
          </article>
          <article className="login-feature-card">
            <div className="login-feature-copy"><span><Boxes aria-hidden="true"/> Inventory</span><h3>Count field supplies</h3><p>Update equipment quantities as stock moves in or out.</p></div>
            <figure><img src="/landing/inventory.webp" width="1522" height="1033" loading="lazy" decoding="async" alt="FireOps inventory screen showing equipment and supply counts"/></figure>
          </article>
          <article className="login-feature-card">
            <div className="login-feature-copy"><span><MessageSquareText aria-hidden="true"/> Communications</span><h3>Keep updates with your crew</h3><p>Post company threads and keep replies tied to each operational update.</p></div>
            <figure><img src="/landing/communications.webp" width="1387" height="1134" loading="lazy" decoding="async" alt="FireOps communications screen showing company threads and crew replies"/></figure>
          </article>
          <article className="login-feature-card login-feature-card--receipts">
            <div className="login-feature-copy"><span><ReceiptText aria-hidden="true"/> Receipts</span><h3>Review field expenses</h3><p>Crew can upload receipts while owners filter, review, and maintain expense records.</p></div>
            <figure><img src="/landing/receipts.webp" width="1540" height="1021" loading="lazy" decoding="async" alt="FireOps receipts screen showing uploaded crew expenses"/></figure>
          </article>
        </div>
      </section>

      <section className="login-mobile" aria-labelledby="mobile-title">
        <div className="login-mobile-copy">
          <p className="login-mobile-kicker"><Smartphone aria-hidden="true"/> FireOps mobile</p>
          <h2 id="mobile-title">Your operation goes with you.</h2>
          <p>FireOps is available for iPhone and iPad. Sign in with your existing account to work from the same live company records used on the web.</p>
          <ul>
            <li><Check aria-hidden="true"/> Check fleet status and report issues</li>
            <li><Check aria-hidden="true"/> Review assigned resources and active fires</li>
            <li><Check aria-hidden="true"/> Open company documents and training</li>
            <li><BellRing aria-hidden="true"/> Get notified when your crew has an update</li>
          </ul>
          <a href="https://apps.apple.com/app/id6808795667" target="_blank" rel="noreferrer" aria-label="Download FireOps on the App Store"><Download aria-hidden="true"/><span><small>Available on the</small>App Store</span></a>
        </div>
        <div className="login-mobile-device" aria-hidden="true">
          <div className="login-mobile-phone">
            <div className="login-mobile-speaker"/>
            <div className="login-mobile-screen">
              <div className="login-mobile-appbar"><img src="/fireops-icon-64.webp" width="64" height="64" alt=""/><span>FireOps</span><i>3</i></div>
              <p>Good morning</p>
              <h3>Ready for assignment</h3>
              <div className="login-mobile-stats"><span><b>6</b>Vehicles</span><span><b>1</b>Open issue</span></div>
              <div className="login-mobile-card"><span><Truck/></span><div><b>Engine 702</b><small>Ready · Assigned to you</small></div><i/></div>
              <div className="login-mobile-card"><span><MapPinned/></span><div><b>Operations</b><small>2 assigned incidents</small></div><i/></div>
              <div className="login-mobile-tabs"><span><Boxes/>Home</span><span><MapPinned/>Operations</span><span className="active"><Truck/>Fleet</span></div>
            </div>
          </div>
        </div>
      </section>

      <section className="login-pricing" id="pricing" aria-labelledby="pricing-title">
        <div className="login-section-heading">
          <p className="login-section-kicker">Plans for every operation</p>
          <h2 id="pricing-title">Start lean. Scale when fire season demands it.</h2>
          <p>Choose individual career tools or a shared operating workspace for your company.</p>
        </div>
        <div className="pricing-grid">
          <article className="pricing-card"><span>Individual</span><h3>Firefighter Pro</h3><p className="pricing-price"><b>$6</b><small>/ month</small></p><p>Personal qualifications, certificates, employment profile, and career tools.</p><em>Free basic account; Pro is optional.</em><a className="pricing-cta" href="#contact">Talk to us</a></article>
          <article className="pricing-card"><span>Small contractor</span><h3>Starter</h3><p className="pricing-price"><b>$99</b><small>/ month</small></p><p>Up to 10 personnel, 5 resources, fleet inspections, records, and basic operations.</p><em>For one- or two-engine companies.</em><a className="pricing-cta" href="#contact">Talk to us</a></article>
          <article className="pricing-card pricing-card--featured"><span>Growing contractor</span><i>Most popular</i><h3>FireOps Professional</h3><p className="pricing-price"><b>$249</b><small>/ month</small></p><p>Up to 40 personnel and 25 resources, with advanced workforce management, incident operations, maintenance, and reporting.</p><em>Built for multiple resources and seasonal crews.</em><a className="pricing-cta" href="#contact">Talk to us</a></article>
          <article className="pricing-card"><span>Large contractor</span><h3>Business</h3><p className="pricing-price"><b>$499</b><small>/ month</small></p><p>Up to 100 personnel, 75 resources, advanced analytics, integrations, and multi-division operations.</p><a className="pricing-cta" href="#contact">Talk to us</a></article>
          <article className="pricing-card"><span>Enterprise</span><h3>Custom</h3><p className="pricing-price"><b>$799+</b><small>/ month</small></p><p>Large fleets, multiple operating companies, custom integrations, and dedicated onboarding.</p><a className="pricing-cta" href="#contact">Contact sales</a></article>
        </div>
      </section>

      <section className="login-contact" id="contact" aria-labelledby="contact-title">
        <p className="login-section-kicker">Talk with the FireOps team</p>
        <h2 id="contact-title">Want to learn how FireOps can support your operation?</h2>
        <div className="contact-card">
          <a href="tel:+12088617464"><Phone aria-hidden="true"/> 208-861-7464</a>
          <a href="mailto:Clint@firecollc.com"><Mail aria-hidden="true"/> Clint@firecollc.com</a>
        </div>
      </section>

      <section className="login-mission">
        <h2>Less time managing systems. More time supporting crews.</h2>
        <p>FireOps keeps core workflows together, giving leaders confidence in the details and crews confidence that information will be there when needed.</p>
      </section>
    </main>

    <footer className="login-footer"><span>© {new Date().getFullYear()} FireOps</span><a href="/privacy">Privacy Policy</a><span>Built for teams who answer the call.</span></footer>
  </div>;
}
