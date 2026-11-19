export type UserRole = 'member' | 'moderator' | 'admin';

export type PostType = 'experiment' | 'riddle';
export type PostStatus = 'draft' | 'published' | 'hidden';

export type RiddleDifficulty = 'Easy' | 'Medium' | 'Hard';
export type RiddleType = 'Logic' | 'Lateral' | 'Math' | 'Wordplay' | 'Science';

export type Perspective = 'Past' | 'Present' | 'Future' | 'Timeless';
export type ThinkingStyle = 'Science-backed' | 'Plausible' | 'Speculative' | 'Wild imagination';

export type CommentLens = 'ripples' | 'stress_test' | 'branches' | 'answer';
export type CommentStatus = 'visible' | 'hidden';

export type ReactionKind = 'mind_blown' | 'strong_logic' | 'needs_evidence' | 'changed_mind';

export interface Category {
  id: string;
  name: string;
  slug: string;
  brain_region: string;
  color: string;
  description: string;
  position: [number, number, number];
}

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string;
  bio: string;
  interests: string[];
  favorite_category_ids?: string[];
  onboarding_completed?: boolean;
  reading_goal_per_week?: number;
  weekly_digest_enabled?: boolean;
  synapse_total: number;
  role: UserRole;
  badges: string[];
  banned?: boolean;
  email?: string;
  email_verified?: boolean;
  daily_digest_enabled?: boolean;
  created_at: string;
}

export interface ExperimentBody {
  premise: string;
  ripples: string;
  breaks_down: string;
  free_content?: string;
  tags?: string[];
}

export interface PostCounts {
  views: number;
  comments: number;
  insights: number;
  bookmarks: number;
}

export interface MindChangeSummary {
  before_avg: number | null;
  after_avg: number | null;
  delta_avg: number | null;
  vote_count: number;
  user_before: number | null;
  user_after: number | null;
}

export interface Post {
  id: string;
  author_id: string;
  type: PostType;
  title: string;
  slug: string;
  cover_url: string | null;
  intro: string;
  body_json: ExperimentBody;
  perspective: Perspective | string;
  thinking_style: ThinkingStyle | string;
  status: PostStatus;
  reading_minutes: number;
  ai_assisted: boolean;
  ai_disclosure: string | null;
  category_ids: string[];
  forked_from_id?: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  counts: PostCounts;
}

export interface RiddlePublic {
  post_id: string;
  difficulty: RiddleDifficulty;
  riddle_type: RiddleType;
  hints: string[];
  total_hints?: number;
  reveal_mode?: 'author' | 'auto';
  reveal_at: string;
  revealed: boolean;
  accepted_comment_id: string | null;
}

export interface RiddleSecret {
  post_id: string;
  answer_text: string;
  answer_keywords: string[];
  explanation: string;
}

export interface RiddleAttempt {
  user_id: string;
  post_id: string;
  hints_used: number;
  submitted_at: string | null;
  show_all: boolean;
  solved_at: string | null;
  started_at?: string | null;
}

export interface Comment {
  id: string;
  post_id: string;
  lens: CommentLens;
  parent_id: string | null;
  author_id: string;
  body: string;
  status: CommentStatus;
  is_accepted: boolean;
  likely_correct: boolean;
  upvotes: number;
  created_at: string;
}

export interface Reaction {
  user_id: string;
  target_type: 'post' | 'comment';
  target_id: string;
  kind: ReactionKind;
  created_at: string;
}

export interface SynapseEvent {
  id: string;
  user_id: string;
  reason: string;
  points: number;
  source_id: string;
  created_at: string;
}

export interface NotificationItem {
  id: string;
  user_id: string;
  kind:
    | 'digest_post'
    | 'riddle_solved'
    | 'authored_riddle_solved'
    | 'riddle_revealed'
    | 'reply'
    | 'reaction'
    | 'moderation'
    | 'warning'
    | 'appeal';
  title: string;
  body: string;
  href: string;
  read_at: string | null;
  created_at: string;
}

export interface ReportItem {
  id: string;
  reporter_id: string;
  target_type: 'post' | 'comment';
  target_id: string;
  reason: string;
  status: 'open' | 'resolved' | 'dismissed';
  created_at: string;
}

export interface ModAction {
  id: string;
  moderator_id: string;
  target_type: 'post' | 'comment' | 'user' | 'report' | 'appeal';
  target_id: string;
  action: 'hide' | 'restore' | 'warn' | 'ban' | 'unban' | 'dismiss_report' | 'approve_appeal' | 'reject_appeal';
  note: string;
  created_at: string;
}

export interface AppealItem {
  id: string;
  user_id: string;
  target_type: 'post' | 'comment' | 'user';
  target_id: string;
  reason: string;
  status: 'open' | 'approved' | 'rejected';
  reviewer_note: string | null;
  created_at: string;
}

export interface ApiErrorShape {
  code: string;
  message: string;
  fields?: Array<{ field: string; message: string }>;
}

export interface ReadingProgress {
  progress_pct: number;
  last_section: string;
  last_read_at: string;
}

export interface EnrichedPost extends Post {
  author: Pick<Profile, 'id' | 'username' | 'display_name' | 'avatar_url' | 'synapse_total' | 'role' | 'badges'>;
  categories: Category[];
  reaction_counts: Record<ReactionKind, number>;
  user_reactions: ReactionKind[];
  is_bookmarked: boolean;
  is_following_author: boolean;
  trending_score: number;
  mind_change?: MindChangeSummary;
  forked_from_post?: { id: string; title: string; slug: string } | null;
  reading_progress?: ReadingProgress | null;
  riddle?: RiddlePublic;
  riddle_attempt?: {
    hints_used: number;
    revealed_hints: string[];
    answers_unlocked: boolean;
    has_submitted: boolean;
    solved: boolean;
    points_awarded?: number;
  };
  riddle_secret?: {
    answer_text: string;
    explanation: string;
    answer_keywords?: string[];
  } | null;
}

export interface EnrichedComment extends Comment {
  author: Pick<Profile, 'id' | 'username' | 'display_name' | 'avatar_url' | 'synapse_total' | 'role'>;
  reaction_counts?: Record<ReactionKind, number>;
  user_reactions?: ReactionKind[];
  insights_total?: number;
  replies?: EnrichedComment[];
}

export interface BrainBadge {
  id: string;
  name: string;
  description: string;
  category_slug: string | null;
  color: string;
  earned: boolean;
  progress: number;
  target: number;
}

export interface MyBrainData {
  stats: {
    entries_read: number;
    riddles_solved: number;
    hints_used: number;
    current_streak: number;
    regions_explored: number;
    total_regions: number;
    weekly_reads: number;
    reading_goal_per_week: number;
  };
  region_activity: Array<{
    category_id: string;
    slug: string;
    name: string;
    brain_region: string;
    color: string;
    reads: number;
    solves: number;
    bookmarks: number;
    score: number;
    glow: number;
  }>;
  badges: BrainBadge[];
}

export interface CollectionSummary {
  id: string;
  owner_id: string;
  owner_username?: string;
  owner_display_name?: string;
  title: string;
  slug: string;
  note: string;
  is_public: boolean;
  item_count: number;
  contains_post?: boolean;
  created_at: string;
  updated_at: string;
}

export interface CollectionDetail extends CollectionSummary {
  items: EnrichedPost[];
}

export interface AuthorDashboardEntry {
  id: string;
  title: string;
  slug: string;
  type: PostType;
  status: PostStatus;
  published_at: string | null;
  unique_views: number;
  insight_reactions: number;
  avg_mind_shift: number | null;
  comments_count: number;
  solve_rate: number | null;
  avg_hints_used: number | null;
}

export interface WeeklyChallengeData {
  week_key: string;
  starts_at: string;
  ends_at: string;
  riddle: EnrichedPost | null;
  leaderboard: Array<{
    rank: number;
    user_id: string;
    username: string;
    display_name: string;
    hints_used: number;
    duration_seconds: number;
    solved_at: string;
  }>;
  user_rank: number | null;
}
