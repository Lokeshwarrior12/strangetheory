import { useEffect } from 'react';
import { Copy, Download, Share2, X } from 'lucide-react';
import { getCanonicalOrigin } from '../../lib/seo';
import { downloadEntryShareCardPng } from '../../lib/shareCanvas';
import { useToast } from '../ui/ToastContext';
import type { EnrichedPost } from '../../lib/types';

interface ShareCardModalProps {
  open: boolean;
  post: EnrichedPost;
  onClose: () => void;
}

export function ShareCardModal({ open, post, onClose }: ShareCardModalProps) {
  const { pushToast } = useToast();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const sharePath = post.type === 'riddle' ? `/riddle/${post.slug}` : `/post/${post.slug}`;
  const shareUrl = `${getCanonicalOrigin()}${sharePath}`;
  const ogUrl = `/api/og/${encodeURIComponent(post.slug)}.svg`;
  const primaryCat = post.categories[0];

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      pushToast('Share link copied to clipboard.', 'success');
    } catch {
      pushToast(`Copy link: ${shareUrl}`, 'info');
    }
  };

  const handleNativeShare = async () => {
    if (!navigator.share) return handleCopyLink();
    try {
      await navigator.share({ title: post.title, text: post.intro, url: shareUrl });
    } catch {
      // cancelled
    }
  };

  const handleDownloadPng = () => {
    downloadEntryShareCardPng({
      slug: post.slug,
      title: post.title,
      intro: post.intro,
      categoryLabel: primaryCat?.name || 'Observatory',
      brainRegion: primaryCat?.brain_region || 'Cortex',
      accentColor: primaryCat?.color || '#22D3EE',
      authorName: post.author.display_name,
      type: post.type,
    });
    pushToast('Share card PNG downloaded.', 'success');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Share entry card"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
    >
      <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-[#0E1525] p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-xs text-[#22D3EE]">Share Card</p>
            <h2 className="font-display text-xl font-semibold text-white">Share {post.type === 'riddle' ? 'Riddle' : 'Experiment'}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close share dialog"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-slate-800 bg-[#070B14]">
          <img
            src={ogUrl}
            alt={`OpenGraph share preview for ${post.title}`}
            className="aspect-[1200/630] w-full object-cover"
          />
        </div>

        {post.type === 'riddle' && (
          <p className="mt-2 font-mono text-[11px] text-slate-400">
            Spoiler protection active: the riddle answer never appears on share cards or OpenGraph previews.
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleCopyLink}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#22D3EE] px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300"
          >
            <Copy className="h-3.5 w-3.5" />
            Copy link
          </button>
          <button
            type="button"
            onClick={handleDownloadPng}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#131D33] px-4 py-2 text-xs font-semibold text-slate-100 hover:border-[#22D3EE]"
          >
            <Download className="h-3.5 w-3.5" />
            Download image
          </button>
          {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
            <button
              type="button"
              onClick={handleNativeShare}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#070B14] px-3.5 py-2 text-xs font-medium text-slate-300 hover:text-white"
            >
              <Share2 className="h-3.5 w-3.5" />
              System share
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
