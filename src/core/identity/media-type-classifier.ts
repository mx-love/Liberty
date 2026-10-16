import type { MediaType } from '../types/media.js';

export interface MediaTypeClassificationOptions {
  /** `TV` family labels are useful source metadata, but ambiguous in danmu_api labels. */
  readonly treatBareTvAsSeries?: boolean;
}

function normalizeLabels(values: readonly unknown[]): string {
  return values
    .filter((value) => value !== null && value !== undefined)
    .map((value) => String(value).normalize('NFKC').toLocaleLowerCase('zh-CN').trim())
    .filter(Boolean)
    .join(' ');
}

const MOVIE_CATEGORY_TOKENS = new Set([
  '动作片',
  '動作片',
  '喜剧片',
  '喜劇片',
  '爱情片',
  '愛情片',
  '科幻片',
  '恐怖片',
  '剧情片',
  '劇情片',
  '战争片',
  '戰爭片',
  '犯罪片',
  '悬疑片',
  '懸疑片',
  '惊悚片',
  '驚悚片',
  '奇幻片',
  '冒险片',
  '冒險片',
  '灾难片',
  '災難片',
  '武侠片',
  '武俠片',
  '古装片',
  '古裝片',
]);

function hasBoundedMovieCategory(value: string): boolean {
  return value
    .split(/[\s,，、/|;；·・()[\]【】]+/u)
    .some((token) => MOVIE_CATEGORY_TOKENS.has(token));
}

/**
 * Classify transport labels without discarding their original category text.
 *
 * Animation movies must be checked before the broader animation family: a
 * label such as `动漫电影` carries both animation and movie words, while its
 * playback identity is still a movie rather than an episodic anime series.
 */
export function classifyMediaTypeLabels(
  values: readonly unknown[],
  options: MediaTypeClassificationOptions = {},
): MediaType {
  const value = normalizeLabels(values);
  if (!value) return 'unknown';

  const hasAnimation = /(?:日番|番剧|动漫|動畫|动画|\banime\b|\banimation\b|\banimated\b)/iu.test(value);
  const hasMovie = /(?:电影|電影|影片|剧场版|劇場版|\bmovie\b|\bfilm\b)/iu.test(value);
  const hasSeries = /(?:电视剧|電視劇|连续剧|連續劇|剧集|劇集|韩剧|韓劇|日剧|日劇|美剧|美劇|欧美剧|歐美劇|日韩剧|日韓劇|国产剧|國產劇|大陆剧|大陸劇|\bseries\b|\bdrama\b)/iu.test(value);
  const hasMovieCategory = hasBoundedMovieCategory(value);

  // `动漫电影`, `动画电影`, `Animated Movie`, and equivalent split
  // transport fields are movies. The raw labels remain available as genre
  // evidence on SourceRecord/DanmakuMediaCandidate.
  if (hasAnimation && hasMovie) return 'movie';
  if (hasAnimation) return 'anime';
  if (/(?:综艺|綜藝|真人秀|\bvariety\b)/iu.test(value)) return 'variety';
  if (/(?:纪录片|紀錄片|记录片|紀錄|纪录|\bdocumentary\b)/iu.test(value)) return 'documentary';
  if (hasMovie) return 'movie';
  // A bounded AppleCMS movie category is weaker than explicit episodic or
  // animation metadata. For example, `电视剧 动作片` remains a series, while
  // a standalone `动作片` is a movie. A generic `片` suffix is never enough.
  if (hasSeries) return 'series';
  if (options.treatBareTvAsSeries && /\btv(?:series|show)?\b/iu.test(value)) return 'series';
  if (hasMovieCategory) return 'movie';
  return 'unknown';
}
