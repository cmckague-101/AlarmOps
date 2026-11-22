// Load app-wide styles before component styles so the existing cascade order is kept.
import './styles.css';
import { useEffect } from 'react';
import './privacy.css';

const contactEmail = 'thetinykings@icloud.com';

export default function PrivacyPolicy() {
  useEffect(() => {
    const previousTitle = document.title;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousDescription = description?.content;
    document.title = 'Privacy Policy | AlarmOps';
    if (description) description.content = 'Privacy Policy for AlarmOps.';
    return () => {
      document.title = previousTitle;
      if (description && previousDescription) description.content = previousDescription;
    };
  }, []);

  return <div className="privacy-page">
    <header className="privacy-header">
      <a className="privacy-brand" href="/" aria-label="AlarmOps home">
        <img src="/alarmops-wordmark-light-440.webp" width="440" height="147" alt="AlarmOps" />
      </a>
      <a className="privacy-home" href="/">Return to AlarmOps</a>
    </header>

    <main className="privacy-main">
      <div className="privacy-intro">
        <p className="privacy-eyebrow">AlarmOps</p>
        <h1>Privacy Policy</h1>
        <p className="privacy-effective">Effective September 4, 2026</p>
        <p>This Privacy Policy explains how FireOps (“FireOps,” “we,” “us,” or “our”) collects, uses, stores, and shares information when you use our website, iOS application, and related services (collectively, the “Service”).</p>
      </div>

      <nav className="privacy-summary" aria-label="Privacy summary">
        <strong>At a glance</strong>
        <ul>
          <li>FireOps is an invite-only operations service for authorized companies and crews.</li>
          <li>We do not sell personal information or use it for third-party advertising.</li>
          <li>We do not use cross-app or cross-site advertising trackers.</li>
          <li>Company data is available only to authorized users, subject to role and company access controls.</li>
        </ul>
      </nav>

      <section>
        <h2>1. Scope and company accounts</h2>
        <p>FireOps is provided to organizations that manage wildland fire operations, fleets, crews, and related records. Your organization may control information entered by its owners and members. When an organization determines why and how personal information is processed, requests concerning that information may need to be handled by the organization’s account owner.</p>
      </section>

      <section>
        <h2>2. Information we collect</h2>
        <h3>Account and contact information</h3>
        <p>We may collect your name, email address, phone number, authentication identifiers, company membership, role, account status, and invitation or account activity.</p>

        <h3>Company and operational information</h3>
        <p>Authorized users may provide company details, crew records, training and registration records, inventory, communications, issue reports, activity history, vehicle information, assignments, notes, VINs, license plates, and related operational records.</p>

        <h3>Files and media</h3>
        <p>The Service may store vehicle photos, company documents, vehicle documents, crew credentials, and other files selected by authorized users. On iOS, FireOps requests photo-library access only when you choose a vehicle photo. Assistant voice requests microphone and speech recognition permission only when you choose Talk. Web voice audio is sent to our speech provider for transcription and spoken replies; iPhone voice uses on-device speech. Voice stops when you end it, close the panel, or sign out; on iPhone it also stops when the app goes into the background.</p>

        <h3>Vehicle telemetry and integrations</h3>
        <p>If an organization connects a supported fleet integration such as Motive, we may process integration credentials and vehicle data made available by that provider, including vehicle location, speed, connection status, timestamps, and camera status or requested vehicle-camera images. Availability depends on the organization’s integration settings and provider permissions.</p>

        <h3>Technical information</h3>
        <p>Our infrastructure may process device and network information needed to operate and protect the Service, such as IP address, browser or device type, operating system, request timestamps, authentication events, and diagnostic or error information. Apple may separately collect TestFlight and App Store diagnostics under Apple’s privacy terms.</p>
      </section>

      <section>
        <h2>3. How we use information</h2>
        <p>We use information to:</p>
        <ul>
          <li>authenticate users and maintain secure sessions;</li>
          <li>provide company-scoped fleet, crew, communications, document, training, inventory, and incident features;</li>
          <li>process assignments, issue updates, registrations, uploads, and other requested actions;</li>
          <li>connect and operate integrations selected by company owners;</li>
          <li>maintain data integrity, synchronize updates, prevent unauthorized access, and investigate abuse;</li>
          <li>support users, troubleshoot errors, and improve reliability; and</li>
          <li>comply with legal obligations and enforce our agreements.</li>
        </ul>
      </section>

      <section>
        <h2>4. How we disclose information</h2>
        <p>We may disclose information in these circumstances:</p>
        <ul>
          <li><strong>Within your organization.</strong> Authorized owners, administrators, and members may access company information according to their role.</li>
          <li><strong>Service providers.</strong> We use vendors that provide hosting, authentication, database, file storage, realtime synchronization, build distribution, and related infrastructure. Supabase currently provides core backend services.</li>
          <li><strong>Connected services.</strong> When a company owner enables an integration, information is exchanged with that provider as needed to provide the requested feature. Motive is an example of an optional connected service.</li>
          <li><strong>Public incident sources.</strong> FireOps retrieves wildland incident information from public government data services. Requests to those services may include ordinary network information.</li>
          <li><strong>Legal and safety reasons.</strong> We may disclose information when reasonably necessary to comply with law, protect rights or safety, investigate fraud or abuse, or respond to valid legal process.</li>
          <li><strong>Business transfers.</strong> Information may transfer as part of a merger, acquisition, financing, reorganization, or sale of assets, subject to applicable law.</li>
        </ul>
        <p>We do not sell personal information. We do not share personal information for cross-context behavioral advertising.</p>
      </section>

      <section>
        <h2>5. Data retention</h2>
        <p>We retain information while needed to provide the Service to an organization, fulfill the purposes described in this policy, resolve disputes, maintain security and audit records, and satisfy legal obligations. Retention may vary by data type and customer requirements. Deleted information may remain temporarily in backups or be retained where required by law.</p>
      </section>

      <section>
        <h2>6. Security</h2>
        <p>We use administrative, technical, and organizational safeguards designed to protect information, including authenticated access, company-scoped authorization, encrypted network transport, and restricted storage access. No electronic system is completely secure, so we cannot guarantee absolute security.</p>
      </section>

      <section>
        <h2>7. Your choices and rights</h2>
        <p>You may update certain information through the Service or ask your company owner to correct company-managed records. Depending on your location, you may have rights to request access, correction, deletion, restriction, portability, or information about processing.</p>
        <p>To request account deletion or exercise a privacy right, contact your company owner or email <a href={`mailto:${contactEmail}`}>{contactEmail}</a>. Include the email address associated with your account and your company name. We may verify your identity and coordinate with your organization before completing a request. We will not discriminate against you for exercising applicable privacy rights.</p>
      </section>

      <section>
        <h2>8. Children’s privacy</h2>
        <p>The Service is intended for authorized business users and is not directed to children under 13. We do not knowingly collect personal information from children under 13. Contact us if you believe a child has provided information to the Service.</p>
      </section>

      <section>
        <h2>9. International processing</h2>
        <p>Information may be processed in the United States and other locations where our service providers operate. Those locations may have different data-protection laws than your jurisdiction. We use appropriate safeguards where required by applicable law.</p>
      </section>

      <section>
        <h2>10. Changes to this policy</h2>
        <p>We may update this policy as the Service or legal requirements change. We will post the revised policy here and update its effective date. Material changes may also be communicated through the Service or by email when appropriate.</p>
      </section>

      <section>
        <h2>11. Contact us</h2>
        <p>Questions, privacy requests, and complaints may be sent to:</p>
        <address><a href={`mailto:${contactEmail}`}>{contactEmail}</a></address>
      </section>
    </main>

    <footer className="privacy-footer">
      <span>© {new Date().getFullYear()} FireOps</span>
      <a href={`mailto:${contactEmail}`}>Privacy contact</a>
    </footer>
  </div>;
}
