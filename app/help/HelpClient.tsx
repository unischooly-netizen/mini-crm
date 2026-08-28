'use client';

import { useState } from 'react';
import Link from 'next/link';
import BrandHeader from '@/app/components/BrandHeader';
import ThemeToggle from '@/app/components/ThemeToggle';

type Role = 'admin' | 'data_team' | 'presales_agent' | 'vertical_head' | 'sales_counsellor';

const cardStyle: React.CSSProperties = {
  background: 'var(--card-bg)',
  border: '1px solid var(--card-border)',
  borderRadius: 14,
  padding: '20px 22px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  marginBottom: 16,
};

const secondaryButtonStyle: React.CSSProperties = {
  background: 'var(--card-bg)',
  color: 'var(--fg)',
  border: '1px solid var(--card-border)',
  borderRadius: 10,
  padding: '9px 16px',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};

const backLinkStyle: React.CSSProperties = {
  color: 'var(--muted)',
  fontSize: 14,
  textDecoration: 'none',
};

function tabStyle(active: boolean): React.CSSProperties {
  return {
    padding: '10px 18px',
    borderRadius: 10,
    border: active ? 'none' : '1px solid var(--card-border)',
    background: active ? 'linear-gradient(135deg, var(--accent-dark), var(--accent))' : 'var(--card-bg)',
    color: active ? '#fff' : 'var(--fg)',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg)', margin: '0 0 8px' }}>
      {children}
    </h3>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 14.5, lineHeight: 1.6, color: 'var(--fg)', margin: '0 0 10px' }}>
      {children}
    </p>
  );
}

function UL({ items }: { items: React.ReactNode[] }) {
  return (
    <ul style={{ margin: '0 0 12px', paddingLeft: 20, fontSize: 14.5, lineHeight: 1.7, color: 'var(--fg)' }}>
      {items.map((item, i) => (
        <li key={i} style={{ marginBottom: 4 }}>{item}</li>
      ))}
    </ul>
  );
}

function Chip({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 999,
        fontSize: 12.5,
        fontWeight: 600,
        background: color,
        color: '#fff',
        marginRight: 6,
        marginBottom: 4,
      }}
    >
      {children}
    </span>
  );
}

function homeLinkFor(role: Role): string {
  if (role === 'presales_agent') return '/dashboard';
  if (role === 'vertical_head' || role === 'sales_counsellor') return '/qualified-leads';
  return '/admin';
}

export default function HelpClient({ role, name }: { role: Role; name: string }) {
  const defaultTab: Role =
    role === 'admin' || role === 'data_team' ? 'presales_agent' : role;
  const [tab, setTab] = useState<Role>(defaultTab);

  return (
    <div className="page-shell" style={{ maxWidth: 880, margin: '0 auto', padding: '24px 16px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 10,
          marginBottom: 18,
        }}
      >
        <BrandHeader />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ThemeToggle />
          <Link href={homeLinkFor(role)} style={secondaryButtonStyle}>
            Back
          </Link>
        </div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--fg)', margin: '0 0 4px' }}>
          Help
        </h2>
        <Link href={homeLinkFor(role)} style={backLinkStyle}>
          &larr; Back to your leads
        </Link>
      </div>

      <div style={cardStyle}>
        <SectionTitle>What the colours mean</SectionTitle>
        <P>These colours show up all over the app, on badges and buttons. They mean the same thing everywhere:</P>
        <div>
          <Chip color="#16a34a">Green</Chip>
          <Chip color="#d97706">Orange</Chip>
          <Chip color="#dc2626">Red</Chip>
          <Chip color="#6b7280">Grey</Chip>
        </div>
        <P>
          Green means done or good (Qualified, Joined, Trial Done, Closed Won). Orange means it needs
          attention or is still pending. Red means something didn&apos;t go well (Not Qualified, Not
          Joined, Cancelled, Closed Lost). Grey means nothing has happened yet.
        </P>
      </div>

      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', marginBottom: 16, paddingBottom: 4 }}>
        <button style={tabStyle(tab === 'presales_agent')} onClick={() => setTab('presales_agent')}>
          Pre-Sales Agent
        </button>
        <button style={tabStyle(tab === 'vertical_head')} onClick={() => setTab('vertical_head')}>
          Vertical Head
        </button>
        <button style={tabStyle(tab === 'sales_counsellor')} onClick={() => setTab('sales_counsellor')}>
          Sales Counsellor
        </button>
      </div>

      {tab === 'presales_agent' && (
        <>
          <div style={cardStyle}>
            <SectionTitle>Your leads list</SectionTitle>
            <P>Your leads are sorted into tabs so you always know what to do next:</P>
            <UL
              items={[
                <><b>New</b> — you haven&apos;t called them yet.</>,
                <><b>Not Picked</b> — you tried calling but couldn&apos;t reach them.</>,
                <><b>Follow-up Needed</b> — you spoke to them, but they need another call later.</>,
                <><b>Qualified</b> — they&apos;re interested, ready to be handed to Sales.</>,
                <><b>Not Qualified</b> — closed, not moving forward.</>,
              ]}
            />
          </div>

          <div style={cardStyle}>
            <SectionTitle>Every time you call a lead</SectionTitle>
            <P>Open the lead and log what happened on that call. You get up to 9 call attempts per lead. Pick one of these for the attempt:</P>
            <UL
              items={[
                'Connected',
                'No Answer',
                'Busy',
                'Switched Off',
                'Wrong Number',
                'No Incoming Call',
                'Number not connecting',
              ]}
            />
            <P>
              <b>Good to know:</b> if you pick anything other than &quot;Connected&quot;, the app automatically
              books your next follow-up call for you. You don&apos;t need to set a date or time yourself
              in that case — just call again when it&apos;s due.
            </P>
          </div>

          <div style={cardStyle}>
            <SectionTitle>Once you actually speak to them: Final Outcome</SectionTitle>
            <P>This is the most important field you fill in. It decides what happens to the lead next.</P>
            <UL
              items={[
                <><b>Qualified</b> — moves the lead to Qualified, ready for a Sales meeting.</>,
                <><b>Not Interested / Junior Lead / Wrong Number / Already Learning</b> — closes the lead as Not Qualified.</>,
                <><b>Budget Issue / No Response / Call Back Later</b> — keeps the lead open under Follow-up Needed, so you can try again.</>,
              ]}
            />
          </div>

          <div style={cardStyle}>
            <SectionTitle>Booking the meeting</SectionTitle>
            <P>Once a lead is Qualified, fill in the meeting details so Sales knows when to reach them:</P>
            <UL
              items={[
                'Course Start Timeline — how soon they want to start.',
                'Meeting Date and Meeting Time.',
                <>Preferred Mode — Phone Call, Teams Meet, Whatsapp call, or Google Meet.</>,
              ]}
            />
          </div>

          <div style={cardStyle}>
            <SectionTitle>Reminder calls</SectionTitle>
            <P>
              You get 3 reminder call slots per lead. Use these to give the lead a quick nudge before
              their meeting so they actually show up. Mark each one as Not Contacted, Contacted, No
              Answer, or Call Back Requested.
            </P>
          </div>

          <div style={cardStyle}>
            <SectionTitle>Remarks</SectionTitle>
            <P>
              This is your free notes box. Keep it updated — anyone who opens this lead after you
              (a Vertical Head, a Sales Counsellor, an Admin) will read it to understand the history.
            </P>
          </div>

          <div style={cardStyle}>
            <SectionTitle>What happens after you qualify a lead</SectionTitle>
            <P>
              You don&apos;t need to do anything else — it&apos;s automatic. A Vertical Head picks it up, assigns
              a Sales Counsellor, and the lead moves through its own meeting/trial/admission process.
              You can check the Qualified Leads, Reschedule Pending, and Cancelled tabs any time to see
              how a lead you handed off is doing.
            </P>
          </div>
        </>
      )}

      {tab === 'vertical_head' && (
        <>
          <div style={cardStyle}>
            <SectionTitle>Your home page</SectionTitle>
            <P>
              Your home page is Qualified Leads. These are leads a Pre-Sales Agent has already spoken to
              and marked as interested.
            </P>
          </div>

          <div style={cardStyle}>
            <SectionTitle>Your main job: assign a Sales Counsellor</SectionTitle>
            <P>
              For each lead, use the &quot;Assigned Sales Counsellor&quot; dropdown to pick who on your team
              will run the meeting, trial, and admission for that lead. That&apos;s it — once assigned,
              the Sales Counsellor takes it from there.
            </P>
          </div>

          <div style={cardStyle}>
            <SectionTitle>Handover Status — tracking where a lead is</SectionTitle>
            <P>This field updates itself automatically as the lead moves forward. You don&apos;t set it by hand:</P>
            <UL
              items={[
                <><b>Qualified - Pending VH</b> — waiting for you to pick it up.</>,
                <><b>VH Assigned</b> — you&apos;ve claimed it.</>,
                <><b>Counsellor Assigned</b> — you&apos;ve handed it to a Sales Counsellor.</>,
                <><b>Meeting Completed</b>, <b>Trial Completed</b>, <b>Admission Closed</b> — later stages, updated by the Sales Counsellor&apos;s work.</>,
              ]}
            />
          </div>

          <div style={cardStyle}>
            <SectionTitle>Watching progress</SectionTitle>
            <P>
              You can open any lead to see meeting, trial, and admission progress, but those fields are
              filled in by the Sales Counsellor. Your job is to watch and reassign a lead to someone else
              if needed. Use the Reschedule Pending and Cancelled tabs to spot meetings that need a
              second look.
            </P>
          </div>
        </>
      )}

      {tab === 'sales_counsellor' && (
        <>
          <div style={cardStyle}>
            <SectionTitle>Your home page</SectionTitle>
            <P>
              Your home page is Qualified Leads. It shows leads a Vertical Head has assigned to you.
            </P>
          </div>

          <div style={cardStyle}>
            <SectionTitle>When the meeting happens: Connecting Status</SectionTitle>
            <P>When the scheduled meeting time comes, log what happened:</P>
            <UL
              items={[
                <><b>Joined</b> — they showed up. Meeting Status becomes Completed.</>,
                <><b>Not Joined</b> — they didn&apos;t show up. Meeting Status becomes Not Completed.</>,
                <><b>Rescheduled</b> — fill in the new Next Meeting Date and Time; that becomes the meeting&apos;s new time automatically.</>,
                <><b>Cancelled</b> — the meeting is off.</>,
              ]}
            />
            <P>
              <b>Good to know:</b> Meeting Status is calculated for you from Connecting Status — you
              can&apos;t (and don&apos;t need to) change it directly.
            </P>
          </div>

          <div style={cardStyle}>
            <SectionTitle>Trial</SectionTitle>
            <P>Same idea as the meeting. Set the Trial Status:</P>
            <UL
              items={[
                'Pending',
                'Trial Done',
                'Trial Not Done',
                <><b>Rescheduled</b> — fill in Next Trial Date and Time.</>,
                'Trial Scheduled but not done',
              ]}
            />
          </div>

          <div style={cardStyle}>
            <SectionTitle>Admission — the final result</SectionTitle>
            <UL
              items={[
                'Pending',
                'On Hold',
                <><b>Closed Won</b> — they enrolled.</>,
                <><b>Closed Lost</b> — they didn&apos;t.</>,
              ]}
            />
          </div>

          <div style={cardStyle}>
            <SectionTitle>Reminder calls</SectionTitle>
            <P>
              You can log the same 3 reminder call slots as the Pre-Sales Agent if you&apos;re the one
              reminding the lead about a meeting or trial.
            </P>
          </div>

          <div style={cardStyle}>
            <SectionTitle>Counsellor / Meeting Update</SectionTitle>
            <P>
              Your notes box. Keep it updated so a Vertical Head or Admin can see where things stand
              on this lead without having to ask you directly.
            </P>
          </div>
        </>
      )}

      <div style={{ ...cardStyle, marginTop: 24, background: 'var(--card-bg)' }}>
        <SectionTitle>Signed in as</SectionTitle>
        <P>{name} — if something on this page doesn&apos;t match what you see in the app, let your Admin know.</P>
      </div>
    </div>
  );
}
