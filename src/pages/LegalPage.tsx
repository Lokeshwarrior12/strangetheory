import { APP_NAME, DEFAULT_CONTACT_EMAIL, LEGAL_LAST_UPDATED } from '../lib/config';
import type { AppRoute } from '../components/nav/Header';

interface LegalPageProps {
  doc: 'guidelines' | 'privacy' | 'terms' | 'about';
  contactEmail?: string;
  onNavigate?: (route: AppRoute) => void;
}

export function LegalPage({ doc, contactEmail = DEFAULT_CONTACT_EMAIL, onNavigate }: LegalPageProps) {
  const titles = {
    about: `About ${APP_NAME}`,
    guidelines: 'Community Guidelines',
    privacy: 'Privacy Policy',
    terms: 'Terms of Service',
  };

  return (
    <article className="mx-auto max-w-3xl px-6 py-14 space-y-6">
      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-4 text-xs">
        {(['about', 'guidelines', 'privacy', 'terms'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => onNavigate?.({ name: 'legal', doc: tab })}
            className={`rounded-lg px-3 py-1.5 font-semibold capitalize ${
              doc === tab ? 'bg-[#22D3EE] text-slate-950' : 'border border-slate-800 bg-[#0E1525] text-slate-300'
            }`}
          >
            {tab === 'guidelines' ? 'Community Guidelines' : tab}
          </button>
        ))}
      </div>

      <div>
        <h1 className="font-display text-4xl font-semibold text-white">{titles[doc]}</h1>
        <p className="mt-2 font-mono text-xs text-slate-400">Last updated: {LEGAL_LAST_UPDATED}</p>
      </div>

      {doc === 'about' && (
        <div className="editorial-prose text-lg space-y-4">
          <p>
            {APP_NAME} is an observatory for rigorous curiosity—a quiet public library where scientists, philosophers, builders, and puzzle solvers publish structured thought experiments (&ldquo;What if...&rdquo;) and lateral riddles.
          </p>
          <p>
            Every thought experiment follows a disciplined intellectual arc: define the Premise, trace 1st, 2nd, and 3rd order Ripple Effects, and explicitly surface Where This Breaks Down. Readers discuss across three analytical lenses—Ripples, Stress Test, and Branches—and can fork any Branch into a linked successor inquiry.
          </p>
          <p>
            Riddles enforce strict server-side spoiler protection: hints unlock progressively at your choice, community guesses stay behind a curtain until you contribute or opt in, and official explanations remain sealed until the reveal rule triggers.
          </p>
        </div>
      )}

      {doc === 'guidelines' && (
        <div className="editorial-prose text-lg space-y-4">
          <p>
            <strong>1. Critique premises, never people.</strong> Stress-test assumptions rigorously and charitably. Personal attacks, slurs, or bad-faith harassment result in immediate content removal.
          </p>
          <p>
            <strong>2. Respect Focus Limits.</strong> Daily publishing is capped at two works per 24 hours, comments are concise (1,000 characters max), and new accounts under 24 hours cannot include external links.
          </p>
          <p>
            <strong>3. Protect riddle spoilers.</strong> Keep guesses and reasoning inside the Answers thread so fellow solvers can enjoy working through the puzzle unaided.
          </p>
          <p>
            <strong>4. Honest AI disclosure.</strong> Every published experiment requires an explicit AI-assistance disclosure noting whether an AI model helped draft or verify arguments.
          </p>
        </div>
      )}

      {doc === 'privacy' && (
        <div className="editorial-prose text-lg space-y-4">
          <p>
            <strong>1. Data We Collect.</strong> {APP_NAME} collects only the minimum information needed to run your account: email address, username, display name, salted password hash, and the thought experiments, riddles, and discussion notes you choose to publish.
          </p>
          <p>
            <strong>2. Strictly-Necessary Cookies.</strong> We set only two functional cookies: an HTTP-only signed session cookie (<code>st_session</code>) for authentication and a CSRF protection token cookie (<code>st_csrf</code>). We do not use third-party advertising trackers or cross-site tracking cookies.
          </p>
          <p>
            <strong>3. Privacy-First Analytics.</strong> Usage telemetry records aggregated route views and interaction counts without selling personal data or building ad profiles.
          </p>
          <p>
            <strong>4. Data Export &amp; Account Deletion.</strong> You own your data: in Settings, you can export your complete profile, posts, comments, bookmarks, and Synapse ledger as JSON at any time, or permanently delete your account and associated personal records.
          </p>
          <p>
            <strong>5. Privacy Requests.</strong> For privacy or data questions, write to{' '}
            <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
          </p>
        </div>
      )}

      {doc === 'terms' && (
        <div className="editorial-prose text-lg space-y-4">
          <p>
            <strong>1. Eligibility &amp; Accounts.</strong> By creating an account on {APP_NAME}, you agree to provide accurate registration details, verify your email address before publishing, safeguard your credentials, and abide by our Community Guidelines. You may maintain one personal account and may delete it at any time in Settings.
          </p>
          <p>
            <strong>2. Authorship &amp; Branching License.</strong> You retain full ownership and copyright over original thought experiments, riddles, and comments you publish on {APP_NAME}. By publishing, you grant {APP_NAME} a non-exclusive, worldwide, royalty-free license to host, display, and allow fellow members to fork linked Branches with attribution to your post.
          </p>
          <p>
            <strong>3. Acceptable Use &amp; Focus Limits.</strong> Automated scraping, spam, harassment, deliberate spoiler leaks outside designated answer threads, or circumvention of rate limits and anti-spam Focus Limits (daily publishing caps and link restrictions) are prohibited.
          </p>
          <p>
            <strong>4. Moderation &amp; Appeals.</strong> Moderators and administrators may hide content, lock threads, issue warnings, or suspend accounts that breach these Terms or the Community Guidelines. Any affected member may submit a formal appeal for human review through the moderation console.
          </p>
          <p>
            <strong>5. Availability &amp; Disclaimers.</strong> {APP_NAME} is provided &ldquo;as is&rdquo; for educational, philosophical, and creative inquiry without warranties of uninterrupted uptime or fitness for a particular purpose.
          </p>
        </div>
      )}

      <div className="border-t border-slate-800 pt-5 text-xs text-slate-400 flex flex-wrap items-center justify-between gap-2">
        <span>
          Contact:{' '}
          <a href={`mailto:${contactEmail}`} className="text-[#22D3EE] underline hover:text-cyan-300">
            {contactEmail}
          </a>
        </span>
        <span className="font-mono">Effective {LEGAL_LAST_UPDATED}</span>
      </div>
    </article>
  );
}
