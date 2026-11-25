import { useState } from 'react';
import { Download, Trash2, Upload, MailCheck } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { CATEGORIES } from '../lib/categories';
import { PWAInstallButton } from '../components/ui/PWAInstallButton';
import { useToast } from '../components/ui/ToastContext';
import type { Profile } from '../lib/types';

interface SettingsPageProps {
  currentUser: Profile | null;
  onOpenAuth: () => void;
  onUserUpdated: (user: Profile) => void;
  onAccountDeleted: () => void;
}

export function SettingsPage({
  currentUser,
  onOpenAuth,
  onUserUpdated,
  onAccountDeleted,
}: SettingsPageProps) {
  const { pushToast } = useToast();
  const [displayName, setDisplayName] = useState(currentUser?.display_name || '');
  const [bio, setBio] = useState(currentUser?.bio || '');
  const [avatarUrl, setAvatarUrl] = useState(currentUser?.avatar_url || '');
  const [interests, setInterests] = useState<string[]>(currentUser?.interests || []);
  const [dailyDigest, setDailyDigest] = useState<boolean>(currentUser?.daily_digest_enabled !== false);
  const [weeklyDigest, setWeeklyDigest] = useState<boolean>(Boolean(currentUser?.weekly_digest_enabled));
  const [readingGoal, setReadingGoal] = useState<number>(currentUser?.reading_goal_per_week || 3);

  const [newEmail, setNewEmail] = useState(currentUser?.email || '');
  const [emailPassword, setEmailPassword] = useState('');
  const [verifyPreview, setVerifyPreview] = useState<string | null>(null);

  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');

  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  if (!currentUser) {
    return (
      <div className="mx-auto max-w-xl px-6 py-20 text-center">
        <h1 className="font-display text-3xl font-semibold text-white">Account Settings</h1>
        <p className="mt-3 text-sm text-slate-400">Sign in to manage your profile, security, and exported data.</p>
        <button
          type="button"
          onClick={onOpenAuth}
          className="mt-6 rounded-lg bg-[#22D3EE] px-5 py-2.5 text-sm font-semibold text-slate-950"
        >
          Sign in
        </button>
      </div>
    );
  }

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.updateProfile({
        display_name: displayName,
        bio,
        interests,
        avatar_url: avatarUrl,
        daily_digest_enabled: dailyDigest,
        weekly_digest_enabled: weeklyDigest,
        reading_goal_per_week: readingGoal,
      });
      onUserUpdated(res.user);
      pushToast('Profile settings saved.', 'success');
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Unable to save settings.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleAvatarUpload = async (file: File) => {
    setBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read avatar'));
        reader.readAsDataURL(file);
      });
      const res = await api.uploadImage(dataUrl);
      setAvatarUrl(res.url);
      pushToast('Avatar uploaded — click Save Profile to apply.', 'info');
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Avatar upload failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleEmailUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.updateEmail({ email: newEmail, current_password: emailPassword });
      onUserUpdated(res.user);
      setEmailPassword('');
      if (res.preview_url) setVerifyPreview(res.preview_url);
      pushToast('Email updated! Please verify the new address.', 'success');
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Email update failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handlePasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.updatePassword({ current_password: currentPw, new_password: newPw });
      setCurrentPw('');
      setNewPw('');
      pushToast('Password updated.', 'success');
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Password update failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async () => {
    try {
      const payload = await api.exportMyData();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `strangetheory-${currentUser.username}-export.json`;
      a.click();
      URL.revokeObjectURL(url);
      pushToast('Data export downloaded.', 'success');
    } catch {
      pushToast('Unable to export data.', 'error');
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirm !== currentUser.username) return;
    setBusy(true);
    try {
      await api.deleteAccount();
      pushToast('Your account and personal data have been permanently removed.', 'info');
      onAccountDeleted();
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Unable to delete account.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 space-y-8">
      <div className="border-b border-slate-800 pb-6">
        <h1 className="font-display text-3xl font-semibold text-white">Settings</h1>
        <p className="mt-1 text-sm text-slate-400">
          Manage your public thinker identity, email verification, password, digest preferences, and data rights.
        </p>
      </div>

      {/* Profile Settings */}
      <form onSubmit={handleSaveProfile} className="rounded-2xl border border-slate-800 bg-[#0E1525] p-6 space-y-4">
        <h2 className="font-display text-xl font-semibold text-white">Profile &amp; Preferences</h2>
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-700 bg-[#131D33] font-display text-xl text-[#22D3EE]">
            {avatarUrl ? <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" /> : displayName.slice(0, 1)}
          </div>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-[#070B14] px-3 py-2 text-xs font-medium text-[#22D3EE]">
            <Upload className="h-3.5 w-3.5" />
            Upload Avatar
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleAvatarUpload(f);
              }}
            />
          </label>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">Display Name</label>
          <input
            type="text"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">Bio</label>
          <textarea
            rows={3}
            maxLength={280}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">Interests (up to 6)</label>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => {
              const active = interests.includes(c.name);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() =>
                    setInterests((prev) =>
                      prev.includes(c.name) ? prev.filter((x) => x !== c.name) : prev.length < 6 ? [...prev, c.name] : prev
                    )
                  }
                  className={`rounded-lg border px-2.5 py-1 text-xs ${
                    active ? 'border-[#22D3EE] bg-[#22D3EE]/15 text-[#22D3EE]' : 'border-slate-800 bg-[#070B14] text-slate-400'
                  }`}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">Weekly Reading Goal</label>
          <div className="inline-flex rounded-lg border border-slate-700 bg-[#070B14] p-1">
            {[1, 3, 5].map((goal) => (
              <button
                key={goal}
                type="button"
                onClick={() => setReadingGoal(goal)}
                className={`rounded-md px-3 py-1.5 font-mono text-xs font-semibold ${
                  readingGoal === goal ? 'bg-[#22D3EE] text-slate-950' : 'text-slate-300 hover:text-white'
                }`}
              >
                {goal} / week
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2.5 text-sm text-slate-200 cursor-pointer pt-1">
          <input type="checkbox" checked={dailyDigest} onChange={(e) => setDailyDigest(e.target.checked)} />
          <span>Receive daily digest notifications when followed thinkers publish</span>
        </label>
        <label className="flex items-center gap-2.5 text-sm text-slate-200 cursor-pointer">
          <input type="checkbox" checked={weeklyDigest} onChange={(e) => setWeeklyDigest(e.target.checked)} />
          <span>Subscribe to The Weekly Synapse email digest (max 1 email/week with featured experiment, riddle &amp; top stat)</span>
        </label>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-[#22D3EE] px-5 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300"
          >
            Save Profile
          </button>
          <PWAInstallButton />
        </div>
      </form>

      {/* Email & Verification */}
      <form onSubmit={handleEmailUpdate} className="rounded-2xl border border-slate-800 bg-[#0E1525] p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-xl font-semibold text-white">Email Address</h2>
          <span className={`font-mono text-xs ${currentUser.email_verified ? 'text-emerald-400' : 'text-amber-400'}`}>
            {currentUser.email_verified ? 'Verified' : 'Unverified'}
          </span>
        </div>
        {!currentUser.email_verified && (
          <button
            type="button"
            onClick={async () => {
              try {
                const res = await api.resendVerification();
                if (res.preview_url) setVerifyPreview(res.preview_url);
                pushToast('Verification email sent.', 'info');
              } catch (err) {
                pushToast(err instanceof ApiError ? err.message : 'Unable to dispatch verification email.', 'error');
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-200"
          >
            <MailCheck className="h-3.5 w-3.5" />
            Send Verification Link
          </button>
        )}
        {verifyPreview && (
          <p className="rounded-lg border border-cyan-500/35 bg-cyan-950/30 p-3 text-xs text-cyan-100 break-all">
            Verification link:{' '}
            <a href={verifyPreview} className="underline text-[#22D3EE]">
              {verifyPreview}
            </a>
          </p>
        )}
        <div className="grid sm:grid-cols-2 gap-3">
          <input
            type="email"
            required
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="New email address"
            className="rounded-lg border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100"
          />
          <input
            type="password"
            required
            value={emailPassword}
            onChange={(e) => setEmailPassword(e.target.value)}
            placeholder="Current password"
            className="rounded-lg border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg border border-slate-700 bg-[#131D33] px-4 py-2 text-xs font-semibold text-slate-100 hover:border-[#22D3EE]"
        >
          Update Email
        </button>
      </form>

      {/* Password Update */}
      <form onSubmit={handlePasswordUpdate} className="rounded-2xl border border-slate-800 bg-[#0E1525] p-6 space-y-4">
        <h2 className="font-display text-xl font-semibold text-white">Change Password</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <input
            type="password"
            required
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            placeholder="Current password"
            className="rounded-lg border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100"
          />
          <input
            type="password"
            required
            minLength={10}
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder="New password (min 10 chars)"
            className="rounded-lg border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg border border-slate-700 bg-[#131D33] px-4 py-2 text-xs font-semibold text-slate-100 hover:border-[#22D3EE]"
        >
          Update Password
        </button>
      </form>

      {/* Export & Delete Account */}
      <section className="rounded-2xl border border-slate-800 bg-[#0E1525] p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold text-white">Export Personal Data</h2>
            <p className="text-xs text-slate-400">
              Download a JSON archive of your profile, posts, comments, bookmarks, reactions, and Synapse ledger.
            </p>
          </div>
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#131D33] px-4 py-2 text-xs font-semibold text-[#22D3EE] hover:border-[#22D3EE]"
          >
            <Download className="h-3.5 w-3.5" />
            Export JSON
          </button>
        </div>

        <div className="border-t border-slate-800 pt-5">
          <h3 className="text-sm font-semibold text-rose-400">Delete Account</h3>
          <p className="mt-1 text-xs text-slate-400">
            Permanently deletes your account, posts, comments, and ledger. Type{' '}
            <span className="font-mono text-slate-200">{currentUser.username}</span> to confirm.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <input
              type="text"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={`Type ${currentUser.username}`}
              className="rounded-lg border border-rose-500/35 bg-[#070B14] px-3 py-2 text-sm text-slate-100"
            />
            <button
              type="button"
              disabled={busy || deleteConfirm !== currentUser.username}
              onClick={handleDeleteAccount}
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete My Account
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
