import { useEffect, useRef, useState } from 'react';
import {
  Save,
  Send,
  Eye,
  Plus,
  Trash2,
  Upload,
  Bold,
  Italic,
  List,
  ListOrdered,
  Quote,
  Link2,
  Heading2,
  Image as ImageIcon,
  MailCheck,
} from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { CATEGORIES } from '../../lib/categories';
import { COVER_PRESETS, FOCUS_LIMITS, PERSPECTIVES, THINKING_STYLES } from '../../lib/config';
import { sanitizeRichText } from '../../lib/sanitize';
import { useToast } from '../ui/ToastContext';
import type { EnrichedPost, Perspective, Profile, RiddleDifficulty, RiddleType, ThinkingStyle } from '../../lib/types';

type ActiveBlockKey = 'premise' | 'ripples' | 'breaksDown' | 'freeContent' | 'explanation';

const BLOCK_LABELS: Record<ActiveBlockKey, string> = {
  premise: 'Premise / Question',
  ripples: 'Ripple Effects',
  breaksDown: 'Where This Breaks Down',
  freeContent: 'Free Content',
  explanation: 'Official Explanation',
};

interface StructuredEditorProps {
  currentUser: Profile | null;
  editId?: string;
  initialType?: 'experiment' | 'riddle';
  forkId?: string;
  initialBranchPremise?: string;
  onOpenAuth: () => void;
  onPublished: (post: EnrichedPost) => void;
  onDeleted?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export function StructuredEditor({
  currentUser,
  editId,
  initialType = 'experiment',
  forkId,
  initialBranchPremise,
  onOpenAuth,
  onPublished,
  onDeleted,
  onDirtyChange,
}: StructuredEditorProps) {
  const { pushToast } = useToast();
  const [postType, setPostType] = useState<'experiment' | 'riddle'>(initialType);
  const [draftId, setDraftId] = useState<string | null>(editId || null);
  const [preview, setPreview] = useState(false);

  const [title, setTitle] = useState('');
  const [intro, setIntro] = useState('');
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [selectedCats, setSelectedCats] = useState<string[]>([CATEGORIES[0].id]);
  const [perspective, setPerspective] = useState<Perspective>('Present');
  const [thinkingStyle, setThinkingStyle] = useState<ThinkingStyle>('Speculative');
  const [tagsText, setTagsText] = useState('');
  const [aiAssisted, setAiAssisted] = useState(false);
  const [aiDisclosure, setAiDisclosure] = useState('');

  // Experiment blocks
  const [premise, setPremise] = useState(initialBranchPremise ? `<p>${initialBranchPremise}</p>` : '');
  const [ripples, setRipples] = useState('');
  const [breaksDown, setBreaksDown] = useState('');
  const [freeContent, setFreeContent] = useState('');
  const [activeBlock, setActiveBlock] = useState<ActiveBlockKey>('premise');

  // Riddle fields
  const [difficulty, setDifficulty] = useState<RiddleDifficulty>('Medium');
  const [riddleType, setRiddleType] = useState<RiddleType>('Lateral');
  const [hints, setHints] = useState<string[]>(['']);
  const [answerText, setAnswerText] = useState('');
  const [keywordsText, setKeywordsText] = useState('');
  const [explanation, setExplanation] = useState('');
  const [revealMode, setRevealMode] = useState<'author' | 'auto'>('auto');
  const [revealDays, setRevealDays] = useState(7);

  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string>('Not saved yet');
  const [error, setError] = useState<string | null>(null);
  const [editBlocked, setEditBlocked] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [verificationSending, setVerificationSending] = useState(false);
  const [verificationPreviewUrl, setVerificationPreviewUrl] = useState<string | null>(null);

  const premiseRef = useRef<HTMLTextAreaElement | null>(null);
  const ripplesRef = useRef<HTMLTextAreaElement | null>(null);
  const breaksRef = useRef<HTMLTextAreaElement | null>(null);
  const freeRef = useRef<HTMLTextAreaElement | null>(null);
  const explanationRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // Load existing post when editing
  useEffect(() => {
    if (!editId) return;
    setEditBlocked(null);
    api
      .getPostById(editId)
      .then((res) => {
        const p = res.post;
        if (currentUser && p.author_id !== currentUser.id && currentUser.role !== 'admin') {
          setEditBlocked('You can only edit your own entries.');
          return;
        }
        setDraftId(p.id);
        setPostType(p.type);
        setTitle(p.title);
        setIntro(p.intro);
        setCoverUrl(p.cover_url);
        setSelectedCats(p.category_ids);
        setPerspective((p.perspective as Perspective) || 'Present');
        setThinkingStyle((p.thinking_style as ThinkingStyle) || 'Speculative');
        setTagsText((p.body_json.tags || []).join(', '));
        setAiAssisted(p.ai_assisted);
        setAiDisclosure(p.ai_disclosure || '');
        setPremise(p.body_json.premise || '');
        setRipples(p.body_json.ripples || '');
        setBreaksDown(p.body_json.breaks_down || '');
        setFreeContent(p.body_json.free_content || '');
        if (p.type === 'riddle' && p.riddle) {
          setDifficulty(p.riddle.difficulty);
          setRiddleType(p.riddle.riddle_type);
          setHints(p.riddle.hints.length ? p.riddle.hints : ['']);
          setRevealMode(p.riddle.reveal_mode || 'auto');
        }
        if (p.riddle_secret) {
          setAnswerText(p.riddle_secret.answer_text);
          setExplanation(p.riddle_secret.explanation);
          setKeywordsText((p.riddle_secret.answer_keywords || []).join(', '));
        }
        setDirty(false);
        setSaveStatus('Loaded existing entry');
      })
      .catch((err) => {
        const msg = err instanceof ApiError ? err.message : 'Unable to load post for editing.';
        setEditBlocked(msg);
      });
  }, [editId, currentUser?.id]);

  const markDirty = () => setDirty(true);

  const buildPayload = () => {
    const tags = tagsText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 5);
    return {
      type: postType,
      title: title.trim() || 'Untitled Draft',
      intro: intro.trim().slice(0, FOCUS_LIMITS.MAX_INTRO_LENGTH) || 'Draft thought experiment summary pending.',
      cover_url: coverUrl,
      perspective,
      thinking_style: thinkingStyle,
      category_ids: selectedCats.length ? selectedCats : [CATEGORIES[0].id],
      ai_assisted: aiAssisted,
      ai_disclosure: aiAssisted ? aiDisclosure.trim() || 'AI assisted with editing or brainstorming.' : null,
      forked_from_id: forkId || null,
      body_json: {
        premise: premise.trim() || '<p>Draft premise...</p>',
        ripples: ripples.trim(),
        breaks_down: breaksDown.trim(),
        free_content: freeContent.trim(),
        tags,
      },
      ...(postType === 'riddle'
        ? {
            riddle: {
              difficulty,
              riddle_type: riddleType,
              hints: hints.map((h) => h.trim()).filter(Boolean).slice(0, 3),
              answer_text: answerText.trim() || 'Pending answer',
              answer_keywords: keywordsText
                .split(',')
                .map((k) => k.trim())
                .filter(Boolean),
              explanation: explanation.trim() || '<p>Pending explanation.</p>',
              reveal_mode: revealMode,
              reveal_days: revealDays,
            },
          }
        : {}),
    };
  };

  const saveDraft = async (silent = false): Promise<EnrichedPost | null> => {
    if (!currentUser) return null;
    if (!title.trim()) {
      if (!silent) setError('Enter a title before saving a draft.');
      return null;
    }
    setError(null);
    try {
      const payload = buildPayload();
      const res = draftId ? await api.updatePost(draftId, payload) : await api.createPost(payload);
      setDraftId(res.post.id);
      setDirty(false);
      setSaveStatus(`Saved at ${new Date().toLocaleTimeString()}`);
      if (!silent) pushToast('Draft saved.', 'success');
      return res.post;
    } catch (err) {
      if (!silent) {
        setError(err instanceof ApiError ? err.fields?.[0]?.message || err.message : 'Unable to save draft.');
      }
      return null;
    }
  };

  useEffect(() => {
    if (!currentUser || !dirty || !title.trim() || editBlocked) return;
    const timer = window.setInterval(() => {
      saveDraft(true);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [currentUser, dirty, title, intro, coverUrl, selectedCats, premise, ripples, breaksDown, freeContent, answerText, explanation, hints, editBlocked]);

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      onOpenAuth();
      return;
    }
    if (title.trim().length < 4) {
      setError('Title must be at least 4 characters.');
      return;
    }
    if (intro.trim().length < 10) {
      setError('Intro must be at least 10 characters.');
      return;
    }
    if (aiAssisted && !aiDisclosure.trim()) {
      setError('Please add a brief AI-assistance note since you selected Yes.');
      return;
    }
    if (!premise.trim()) {
      setError(postType === 'riddle' ? 'Riddle question is required.' : 'Premise block is required.');
      return;
    }
    if (postType === 'riddle' && (!answerText.trim() || !explanation.trim())) {
      setError('Riddles require an official answer and explanation.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await saveDraft(true);
      const idToPublish = saved?.id || draftId;
      if (!idToPublish) {
        setError('Unable to save entry before publishing.');
        setBusy(false);
        return;
      }
      const pub = await api.publishPost(idToPublish);
      setDirty(false);
      pushToast('Published to StrangeTheory!', 'success');
      onPublished(pub.post);
    } catch (err) {
      setError(err instanceof ApiError ? err.fields?.[0]?.message || err.message : 'Publish failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeletePost = async () => {
    if (!draftId) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    try {
      await api.deletePost(draftId);
      setDirty(false);
      pushToast('Post deleted.', 'info');
      onDeleted?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete post.');
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  const handleResendVerification = async () => {
    setVerificationSending(true);
    setVerificationPreviewUrl(null);
    try {
      const res = await api.resendVerification();
      pushToast(res.message, 'info');
      if (res.preview_url) setVerificationPreviewUrl(res.preview_url);
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Unable to send verification link.', 'error');
    } finally {
      setVerificationSending(false);
    }
  };

  const handleFileUpload = async (file: File, target: 'cover' | 'inline') => {
    if (!currentUser) {
      onOpenAuth();
      return;
    }
    if (file.size > 4.8 * 1024 * 1024) {
      setError('Image must be smaller than 4.8 MB.');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read file.'));
        reader.readAsDataURL(file);
      });
      const res = await api.uploadImage(dataUrl);
      if (target === 'cover') {
        setCoverUrl(res.url);
      } else {
        insertMarkup(`<img src="${res.url}" alt="Illustration" />`);
      }
      markDirty();
      pushToast('Image uploaded!', 'success');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Image upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const insertMarkup = (before: string, after = '') => {
    const resolvedBlock: ActiveBlockKey =
      postType === 'riddle' && activeBlock !== 'premise' && activeBlock !== 'explanation'
        ? 'premise'
        : activeBlock;

    const map: Record<ActiveBlockKey, { val: string; set: (v: string) => void; ref: typeof premiseRef }> = {
      premise: { val: premise, set: setPremise, ref: premiseRef },
      ripples: { val: ripples, set: setRipples, ref: ripplesRef },
      breaksDown: { val: breaksDown, set: setBreaksDown, ref: breaksRef },
      freeContent: { val: freeContent, set: setFreeContent, ref: freeRef },
      explanation: { val: explanation, set: setExplanation, ref: explanationRef },
    };
    const target = map[resolvedBlock];
    const el = target.ref.current;
    if (!el) {
      const placeholder = after ? 'text' : '';
      target.set(`${target.val}${before}${placeholder}${after}`);
      markDirty();
      return;
    }
    const start = el.selectionStart ?? target.val.length;
    const end = el.selectionEnd ?? target.val.length;
    const selected = target.val.slice(start, end) || (after ? 'text' : '');
    const next = `${target.val.slice(0, start)}${before}${selected}${after}${target.val.slice(end)}`;
    target.set(next);
    markDirty();
    const cursorPos = start + before.length + selected.length;
    window.requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + before.length, cursorPos);
    });
  };

  const toggleCategory = (catId: string) => {
    markDirty();
    setSelectedCats((prev) => {
      if (prev.includes(catId)) {
        return prev.length > 1 ? prev.filter((c) => c !== catId) : prev;
      }
      if (prev.length >= 2) return [prev[1], catId];
      return [...prev, catId];
    });
  };

  if (!currentUser) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20 text-center">
        <h1 className="font-display text-3xl font-semibold text-white">Structured Studio</h1>
        <p className="mt-3 text-slate-400">
          Sign in to craft a structured thought experiment or publish a spoiler-protected riddle.
        </p>
        <button
          type="button"
          onClick={onOpenAuth}
          className="mt-6 rounded-lg bg-[#22D3EE] px-6 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-300"
        >
          Sign in to Write
        </button>
      </div>
    );
  }

  if (editBlocked) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20 text-center">
        <p className="font-mono text-xs text-rose-400">Access Restricted</p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-white">Cannot Edit This Entry</h1>
        <p className="mt-3 text-slate-400">{editBlocked}</p>
      </div>
    );
  }

  const formattingToolbar = (
    <div
      role="toolbar"
      aria-label="Formatting toolbar"
      className="sticky top-[68px] z-20 flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-800 bg-[#0E1525]/95 px-3 py-2 shadow-lg"
    >
      <span className="font-mono text-[11px] text-slate-400 mr-2">
        Target: <span className="text-[#22D3EE]">{BLOCK_LABELS[activeBlock]}</span>
      </span>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => insertMarkup('<h2>', '</h2>')}
        className="rounded p-1.5 text-slate-300 hover:bg-slate-800"
        aria-label="Heading 2"
        title="Heading 2"
      >
        <Heading2 className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => insertMarkup('<strong>', '</strong>')}
        className="rounded p-1.5 text-slate-300 hover:bg-slate-800"
        aria-label="Bold"
        title="Bold"
      >
        <Bold className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => insertMarkup('<em>', '</em>')}
        className="rounded p-1.5 text-slate-300 hover:bg-slate-800"
        aria-label="Italic"
        title="Italic"
      >
        <Italic className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => insertMarkup('<ul><li>', '</li></ul>')}
        className="rounded p-1.5 text-slate-300 hover:bg-slate-800"
        aria-label="Bullet list"
        title="Bullet list"
      >
        <List className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => insertMarkup('<ol><li>', '</li></ol>')}
        className="rounded p-1.5 text-slate-300 hover:bg-slate-800"
        aria-label="Numbered list"
        title="Numbered list"
      >
        <ListOrdered className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => insertMarkup('<blockquote>', '</blockquote>')}
        className="rounded p-1.5 text-slate-300 hover:bg-slate-800"
        aria-label="Quote"
        title="Quote"
      >
        <Quote className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => insertMarkup('<a href="https://example.com">', '</a>')}
        className="rounded p-1.5 text-slate-300 hover:bg-slate-800"
        aria-label="Link"
        title="Link"
      >
        <Link2 className="h-3.5 w-3.5" />
      </button>
      <label className="inline-flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs text-[#22D3EE] hover:bg-slate-800" title="Insert uploaded image">
        <ImageIcon className="h-3.5 w-3.5" />
        <span>Inline Image</span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFileUpload(f, 'inline');
          }}
        />
      </label>
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <h1 className="font-display text-3xl font-semibold text-white">
            {editId ? 'Edit Entry' : forkId ? 'Branch Linked Thought Experiment' : 'Structured Studio'}
          </h1>
          <p className="mt-1 font-mono text-xs text-slate-400">
            {saveStatus} {dirty ? '· Unsaved changes' : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setPreview((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0E1525] px-3.5 py-2 text-xs font-semibold text-slate-200 hover:border-slate-500"
          >
            <Eye className="h-3.5 w-3.5" />
            {preview ? 'Back to Edit' : 'Live Preview'}
          </button>
          <button
            type="button"
            onClick={() => saveDraft(false)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0E1525] px-3.5 py-2 text-xs font-semibold text-slate-200 hover:border-[#22D3EE]"
          >
            <Save className="h-3.5 w-3.5" />
            Save Draft
          </button>
          {draftId && (
            <>
              <button
                type="button"
                onClick={handleDeletePost}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold ${
                  confirmDelete
                    ? 'border-rose-500 bg-rose-600 text-white'
                    : 'border-rose-500/40 bg-rose-950/30 text-rose-300 hover:bg-rose-950/60'
                }`}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {confirmDelete ? 'Confirm Delete' : 'Delete'}
              </button>
              {confirmDelete && (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-lg border border-slate-700 px-2.5 py-2 text-xs text-slate-300"
                >
                  Cancel
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {!editId && (
        <div className="mt-6 inline-flex rounded-lg border border-slate-800 bg-[#0E1525] p-1">
          <button
            type="button"
            onClick={() => {
              setPostType('experiment');
              setActiveBlock('premise');
              markDirty();
            }}
            className={`rounded-md px-4 py-2 text-xs font-semibold transition-colors ${
              postType === 'experiment' ? 'bg-[#22D3EE] text-slate-950' : 'text-slate-300 hover:text-white'
            }`}
          >
            Thought Experiment
          </button>
          <button
            type="button"
            onClick={() => {
              setPostType('riddle');
              setActiveBlock('premise');
              markDirty();
            }}
            className={`rounded-md px-4 py-2 text-xs font-semibold transition-colors ${
              postType === 'riddle' ? 'bg-[#A78BFA] text-slate-950' : 'text-slate-300 hover:text-white'
            }`}
          >
            Lateral Riddle
          </button>
        </div>
      )}

      {!currentUser.email_verified && (
        <div
          role="status"
          className="mt-5 rounded-xl border border-amber-500/40 bg-amber-950/25 p-4 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="space-y-1">
            <p className="flex items-center gap-2 text-xs font-semibold text-amber-200">
              <MailCheck className="h-4 w-4 text-amber-400 shrink-0" />
              Verify your email to publish entries
            </p>
            <p className="text-xs text-slate-300">
              You can save drafts right now. Confirm your email address ({currentUser.email}) before publishing to the observatory.
            </p>
            {verificationPreviewUrl && (
              <p className="text-xs text-cyan-200">
                Verification link:{' '}
                <a href={verificationPreviewUrl} className="font-mono underline text-[#22D3EE] break-all">
                  {verificationPreviewUrl}
                </a>
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={verificationSending}
            onClick={handleResendVerification}
            className="rounded-lg border border-amber-400/50 bg-amber-500/15 px-3.5 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/25 disabled:opacity-50"
          >
            {verificationSending ? 'Sending...' : 'Resend verification link'}
          </button>
        </div>
      )}

      {error && (
        <div role="alert" className="mt-5 rounded-xl border border-rose-500/40 bg-rose-950/40 p-3.5 text-sm text-rose-200">
          {error}
        </div>
      )}

      {preview ? (
        <article className="mt-8 rounded-2xl border border-slate-800 bg-[#0E1525] p-8">
          {coverUrl && (
            <img src={coverUrl} alt="Cover preview" className="mb-6 aspect-[16/9] w-full rounded-xl object-cover" />
          )}
          <h2 className="font-display text-3xl font-semibold text-white">{title || 'Untitled Draft'}</h2>
          <p className="mt-3 text-lg text-slate-300">{intro}</p>
          <div className="mt-6 space-y-6 border-t border-slate-800 pt-6">
            <div>
              <h3 className="font-mono text-xs uppercase tracking-wider text-[#22D3EE] mb-2">
                {postType === 'riddle' ? 'The Riddle' : 'Premise'}
              </h3>
              <div className="editorial-prose" dangerouslySetInnerHTML={{ __html: sanitizeRichText(premise) }} />
            </div>
            {postType === 'experiment' && ripples && (
              <div>
                <h3 className="font-mono text-xs uppercase tracking-wider text-[#A78BFA] mb-2">Ripple Effects</h3>
                <div className="editorial-prose" dangerouslySetInnerHTML={{ __html: sanitizeRichText(ripples) }} />
              </div>
            )}
            {postType === 'experiment' && breaksDown && (
              <div>
                <h3 className="font-mono text-xs uppercase tracking-wider text-amber-400 mb-2">Where This Breaks Down</h3>
                <div className="editorial-prose" dangerouslySetInnerHTML={{ __html: sanitizeRichText(breaksDown) }} />
              </div>
            )}
            {postType === 'experiment' && freeContent && (
              <div>
                <h3 className="font-mono text-xs uppercase tracking-wider text-slate-400 mb-2">Additional Notes</h3>
                <div className="editorial-prose" dangerouslySetInnerHTML={{ __html: sanitizeRichText(freeContent) }} />
              </div>
            )}
          </div>
        </article>
      ) : (
        <form onSubmit={handlePublish} className="mt-6 space-y-6">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Title</label>
            <input
              type="text"
              required
              maxLength={140}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                markDirty();
              }}
              placeholder={
                postType === 'experiment' ? 'What if...' : 'Name your lateral riddle...'
              }
              className="w-full rounded-xl border border-slate-800 bg-[#0E1525] px-4 py-3 font-display text-xl text-white placeholder-slate-500 focus:border-[#22D3EE] focus:outline-none"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-300">Intro Summary (max 280 characters)</label>
              <span className={`font-mono text-xs tabular-nums ${intro.length > 260 ? 'text-amber-400' : 'text-slate-400'}`}>
                {intro.length}/280
              </span>
            </div>
            <textarea
              rows={2}
              required
              maxLength={280}
              value={intro}
              onChange={(e) => {
                setIntro(e.target.value);
                markDirty();
              }}
              placeholder="A crisp two-sentence hook for readers..."
              className="w-full rounded-xl border border-slate-800 bg-[#0E1525] px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:border-[#22D3EE] focus:outline-none"
            />
          </div>

          {/* Brain Region Categories (1-2) */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-2">
              Brain-Region Categories (choose 1 or 2)
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {CATEGORIES.map((cat) => {
                const active = selectedCats.includes(cat.id);
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => toggleCategory(cat.id)}
                    className={`rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${
                      active
                        ? 'border-white/70 bg-[#131D33] text-white font-semibold'
                        : 'border-slate-800 bg-[#0E1525] text-slate-400 hover:border-slate-600'
                    }`}
                  >
                    <span className="inline-block h-2 w-2 rounded-sm mr-1.5" style={{ backgroundColor: cat.color }} />
                    {cat.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Cover Selector: Upload / Presets / Text-only */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <label className="text-xs font-semibold text-slate-300">Cover Visual</label>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0E1525] px-3 py-1.5 text-xs font-medium text-[#22D3EE] hover:border-[#22D3EE]">
                <Upload className="h-3.5 w-3.5" />
                {uploading ? 'Uploading...' : 'Upload Image'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileUpload(f, 'cover');
                  }}
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              {COVER_PRESETS.map((preset) => (
                <button
                  key={preset.url}
                  type="button"
                  onClick={() => {
                    setCoverUrl(preset.url);
                    markDirty();
                  }}
                  className={`rounded-lg border px-3 py-1.5 text-xs ${
                    coverUrl === preset.url
                      ? 'border-[#22D3EE] bg-[#22D3EE]/15 text-[#22D3EE] font-semibold'
                      : 'border-slate-800 bg-[#0E1525] text-slate-300'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setCoverUrl(null);
                  markDirty();
                }}
                className={`rounded-lg border px-3 py-1.5 text-xs ${
                  coverUrl === null
                    ? 'border-[#22D3EE] bg-[#22D3EE]/15 text-[#22D3EE] font-semibold'
                    : 'border-slate-800 bg-[#0E1525] text-slate-300'
                }`}
              >
                Unique Procedural Cover (Auto)
              </button>
            </div>
            {coverUrl && (
              <img src={coverUrl} alt="Selected cover" className="mt-3 h-36 w-full rounded-xl border border-slate-800 object-cover" />
            )}
          </div>

          {postType === 'experiment' ? (
            <>
              <div className="grid sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Perspective</label>
                  <select
                    value={perspective}
                    onChange={(e) => {
                      setPerspective(e.target.value as Perspective);
                      markDirty();
                    }}
                    className="w-full rounded-lg border border-slate-800 bg-[#0E1525] px-3 py-2 text-sm text-slate-100"
                  >
                    {PERSPECTIVES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Thinking Style</label>
                  <select
                    value={thinkingStyle}
                    onChange={(e) => {
                      setThinkingStyle(e.target.value as ThinkingStyle);
                      markDirty();
                    }}
                    className="w-full rounded-lg border border-slate-800 bg-[#0E1525] px-3 py-2 text-sm text-slate-100"
                  >
                    {THINKING_STYLES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Tags (comma separated)</label>
                  <input
                    type="text"
                    value={tagsText}
                    onChange={(e) => {
                      setTagsText(e.target.value);
                      markDirty();
                    }}
                    placeholder="entropy, markets, qualia"
                    className="w-full rounded-lg border border-slate-800 bg-[#0E1525] px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
                  />
                </div>
              </div>

              {/* Formatting Toolbar */}
              {formattingToolbar}

              <div>
                <label className="block text-xs font-semibold text-[#22D3EE] mb-1.5">1. Premise</label>
                <textarea
                  ref={premiseRef}
                  rows={4}
                  required
                  value={premise}
                  onFocus={() => setActiveBlock('premise')}
                  onChange={(e) => {
                    setPremise(e.target.value);
                    markDirty();
                  }}
                  placeholder="<p>Set the core counterfactual constraint clearly...</p>"
                  className="w-full rounded-xl border border-slate-800 bg-[#0E1525] px-4 py-3 text-sm text-slate-100 placeholder-slate-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#A78BFA] mb-1.5">
                  2. Ripple Effects (1st, 2nd &amp; 3rd Order)
                </label>
                <textarea
                  ref={ripplesRef}
                  rows={5}
                  value={ripples}
                  onFocus={() => setActiveBlock('ripples')}
                  onChange={(e) => {
                    setRipples(e.target.value);
                    markDirty();
                  }}
                  placeholder="<ul><li><strong>1st Order:</strong> Immediate shift...</li><li><strong>2nd Order:</strong> Institutional adaptation...</li><li><strong>3rd Order:</strong> Cultural equilibrium...</li></ul>"
                  className="w-full rounded-xl border border-slate-800 bg-[#0E1525] px-4 py-3 text-sm text-slate-100 placeholder-slate-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-amber-400 mb-1.5">3. Where This Breaks Down</label>
                <textarea
                  ref={breaksRef}
                  rows={3}
                  value={breaksDown}
                  onFocus={() => setActiveBlock('breaksDown')}
                  onChange={(e) => {
                    setBreaksDown(e.target.value);
                    markDirty();
                  }}
                  placeholder="<p>Identify physical limits, counter-incentives, or edge cases...</p>"
                  className="w-full rounded-xl border border-slate-800 bg-[#0E1525] px-4 py-3 text-sm text-slate-100 placeholder-slate-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  4. Free Content / Open Synthesis (optional)
                </label>
                <textarea
                  ref={freeRef}
                  rows={3}
                  value={freeContent}
                  onFocus={() => setActiveBlock('freeContent')}
                  onChange={(e) => {
                    setFreeContent(e.target.value);
                    markDirty();
                  }}
                  placeholder="<p>Historical parallels, citations, or open questions for readers...</p>"
                  className="w-full rounded-xl border border-slate-800 bg-[#0E1525] px-4 py-3 text-sm text-slate-100 placeholder-slate-500"
                />
              </div>
            </>
          ) : (
            <>
              <div className="grid sm:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Difficulty</label>
                  <select
                    value={difficulty}
                    onChange={(e) => {
                      setDifficulty(e.target.value as RiddleDifficulty);
                      markDirty();
                    }}
                    className="w-full rounded-lg border border-slate-800 bg-[#0E1525] px-3 py-2 text-sm text-slate-100"
                  >
                    <option value="Easy">Easy (+3)</option>
                    <option value="Medium">Medium (+6)</option>
                    <option value="Hard">Hard (+10)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Riddle Type</label>
                  <select
                    value={riddleType}
                    onChange={(e) => {
                      setRiddleType(e.target.value as RiddleType);
                      markDirty();
                    }}
                    className="w-full rounded-lg border border-slate-800 bg-[#0E1525] px-3 py-2 text-sm text-slate-100"
                  >
                    {['Logic', 'Lateral', 'Math', 'Wordplay', 'Science'].map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Reveal Rule</label>
                  <select
                    value={revealMode}
                    onChange={(e) => {
                      setRevealMode(e.target.value as 'author' | 'auto');
                      markDirty();
                    }}
                    className="w-full rounded-lg border border-slate-800 bg-[#0E1525] px-3 py-2 text-sm text-slate-100"
                  >
                    <option value="auto">Auto-reveal after N days</option>
                    <option value="author">Only when I reveal</option>
                  </select>
                </div>
                {revealMode === 'auto' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Auto-Reveal Days</label>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={revealDays}
                      onChange={(e) => {
                        setRevealDays(Number(e.target.value) || 7);
                        markDirty();
                      }}
                      className="w-full rounded-lg border border-slate-800 bg-[#0E1525] px-3 py-2 text-sm text-slate-100"
                    />
                  </div>
                )}
              </div>

              {/* Formatting Toolbar */}
              {formattingToolbar}

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">Full Riddle Question</label>
                <textarea
                  ref={premiseRef}
                  rows={4}
                  required
                  value={premise}
                  onFocus={() => setActiveBlock('premise')}
                  onChange={(e) => {
                    setPremise(e.target.value);
                    markDirty();
                  }}
                  placeholder="Write the complete puzzle scenario clearly..."
                  className="w-full rounded-xl border border-slate-800 bg-[#0E1525] px-4 py-3 text-sm text-slate-100 placeholder-slate-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-slate-300">Progressive Hints (up to 3)</label>
                  {hints.length < 3 && (
                    <button
                      type="button"
                      onClick={() => setHints([...hints, ''])}
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#22D3EE]"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add Hint
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {hints.map((h, i) => (
                    <div key={i} className="flex gap-2">
                      <input
                        type="text"
                        value={h}
                        onChange={(e) => {
                          const next = [...hints];
                          next[i] = e.target.value;
                          setHints(next);
                          markDirty();
                        }}
                        placeholder={`Hint ${i + 1}`}
                        className="flex-1 rounded-lg border border-slate-800 bg-[#0E1525] px-3 py-2 text-sm text-slate-100"
                      />
                      {hints.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setHints(hints.filter((_, idx) => idx !== i))}
                          className="p-2 text-slate-400 hover:text-rose-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4 rounded-xl border border-emerald-500/25 bg-emerald-950/15 p-4">
                <div>
                  <label className="block text-xs font-semibold text-emerald-300 mb-1">
                    Hidden Answer (server-sealed until revealed)
                  </label>
                  <input
                    type="text"
                    required
                    value={answerText}
                    onChange={(e) => {
                      setAnswerText(e.target.value);
                      markDirty();
                    }}
                    placeholder="Concise official answer"
                    className="w-full rounded-lg border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-emerald-300 mb-1">
                    Accepted Keywords (flags likely matches for you)
                  </label>
                  <input
                    type="text"
                    value={keywordsText}
                    onChange={(e) => {
                      setKeywordsText(e.target.value);
                      markDirty();
                    }}
                    placeholder="silence, quiet"
                    className="w-full rounded-lg border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-emerald-300 mb-1">
                    Hidden Explanation (server-sealed)
                  </label>
                  <textarea
                    ref={explanationRef}
                    rows={3}
                    required
                    value={explanation}
                    onFocus={() => setActiveBlock('explanation')}
                    onChange={(e) => {
                      setExplanation(e.target.value);
                      markDirty();
                    }}
                    placeholder="Explain the key insight behind the solution..."
                    className="w-full rounded-lg border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100"
                  />
                </div>
              </div>
            </>
          )}

          {/* Required AI Assistance Disclosure */}
          <div className="rounded-xl border border-slate-800 bg-[#0E1525] p-4">
            <p className="text-xs font-semibold text-slate-200 mb-2">
              Required AI-Assistance Disclosure
            </p>
            <div className="flex flex-wrap items-center gap-4 text-sm text-slate-200">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="ai_assisted"
                  checked={!aiAssisted}
                  onChange={() => {
                    setAiAssisted(false);
                    markDirty();
                  }}
                />
                <span>No — written entirely by me</span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="ai_assisted"
                  checked={aiAssisted}
                  onChange={() => {
                    setAiAssisted(true);
                    markDirty();
                  }}
                />
                <span>Yes — AI assisted with drafting or checks</span>
              </label>
            </div>
            {aiAssisted && (
              <input
                type="text"
                required
                value={aiDisclosure}
                onChange={(e) => {
                  setAiDisclosure(e.target.value);
                  markDirty();
                }}
                maxLength={300}
                placeholder="Briefly describe how AI assisted (e.g., unit checks, clarity review)..."
                className="mt-3 w-full rounded-lg border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100"
              />
            )}
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg bg-[#22D3EE] px-6 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              {busy ? 'Publishing...' : editId ? 'Save & Publish' : 'Publish Entry'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
