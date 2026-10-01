import type { MediaType } from '../types/media.js';
import type {
  EpisodeConfidence,
  EpisodeContentType,
  EpisodeNumberKind,
  EpisodeParseEvidence,
  EpisodePart,
  EpisodeSpecialKind,
  ParsedEpisodeInfo,
} from '../types/episode.js';
import { parseChineseNumberToken } from '../identity/title-parser.js';

const NUMBER_TOKEN = '[〇零一二两三四五六七八九十百千\\d]+';
const TECHNICAL_TOKEN_PATTERN =
  /(?:1080p|720p|2160p|4k|8k|h\.?264|h\.?265|hevc|av1|10bit|hdr|dolby|aac|国语|粤语|中字|双语|bd|bluray|web-?dl|webrip|线路\s*\d+|备用|高清|超清)/giu;

export interface EpisodeParserOptions {
  readonly mediaType?: MediaType;
}

interface NumericMatch {
  readonly number: number;
  readonly kind: EpisodeNumberKind;
  readonly season: number | null;
  readonly matched: string;
  readonly confidence: EpisodeConfidence;
  readonly evidenceCode: EpisodeParseEvidence['code'];
}

interface ContentMarker {
  readonly contentType: EpisodeContentType;
  readonly specialKind: EpisodeSpecialKind;
  readonly specialNumber: number | null;
  readonly matched: string;
  readonly evidenceCode: EpisodeParseEvidence['code'];
}

function validPositiveEpisodeNumber(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= 100_000;
}

function toNumber(token: string): number | null {
  const value = parseChineseNumberToken(token);
  return value !== null && validPositiveEpisodeNumber(value) ? value : null;
}

function asIsoDate(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2099 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function extractBroadcastDate(value: string): { readonly airDate: string; readonly matched: string } | null {
  const separated = /(?<!\d)((?:19|20)\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?(?!\d)/u.exec(value);
  if (separated) {
    const airDate = asIsoDate(Number(separated[1]), Number(separated[2]), Number(separated[3]));
    if (airDate) return { airDate, matched: separated[0] };
  }

  const compact = /(?<!\d)((?:19|20)\d{2})(\d{2})(\d{2})(?!\d)/u.exec(value);
  if (compact) {
    const airDate = asIsoDate(Number(compact[1]), Number(compact[2]), Number(compact[3]));
    if (airDate) return { airDate, matched: compact[0] };
  }

  return null;
}

function extractPart(value: string): { readonly part: EpisodePart; readonly matched: string } | null {
  const upper = /(?:上篇|上部|上集|上期)(?:版)?/u.exec(value);
  if (upper) return { part: 'upper', matched: upper[0] };
  const lower = /(?:下篇|下部|下集|下期)(?:版)?/u.exec(value);
  if (lower) return { part: 'lower', matched: lower[0] };
  const english = /\bPart\s*0*(\d{1,3})\b/iu.exec(value);
  if (english) return { part: Number(english[1]), matched: english[0] };
  return null;
}

function extractContentMarker(value: string): ContentMarker | null {
  const preview = /(?:预告(?:片)?|先导片|先行片|\btrailer\b|\bPV\s*\d*\b)/iu.exec(value);
  if (preview) {
    return {
      contentType: 'preview',
      specialKind: null,
      specialNumber: null,
      matched: preview[0],
      evidenceCode: 'preview_marker',
    };
  }

  const recap = /(?:总集篇|总集编|回顾|\brecap\b)/iu.exec(value);
  if (recap) {
    return {
      contentType: 'recap',
      specialKind: null,
      specialNumber: null,
      matched: recap[0],
      evidenceCode: 'recap_marker',
    };
  }

  const interview = /(?:采访|访谈|\binterview\b)/iu.exec(value);
  if (interview) {
    return {
      contentType: 'interview',
      specialKind: null,
      specialNumber: null,
      matched: interview[0],
      evidenceCode: 'interview_marker',
    };
  }

  const codedSpecial = /\b(SP|OVA|OAD)\s*0*(\d{1,4})?\b/iu.exec(value);
  if (codedSpecial) {
    const kind = (codedSpecial[1] ?? '').toLocaleLowerCase('en-US') as Exclude<EpisodeSpecialKind, 'extra' | 'special' | null>;
    const specialNumber = codedSpecial[2] ? Number(codedSpecial[2]) : null;
    return {
      contentType: 'special',
      specialKind: kind,
      specialNumber,
      matched: codedSpecial[0],
      evidenceCode: 'special_marker',
    };
  }

  const extra = /(?:番外|加更(?:版)?|花絮|彩蛋|特别节目)/u.exec(value);
  if (extra) {
    return {
      contentType: 'special',
      specialKind: 'extra',
      specialNumber: null,
      matched: extra[0],
      evidenceCode: 'special_marker',
    };
  }

  const special = /(?:特别篇|特别编|特别版)/u.exec(value);
  if (special) {
    return {
      contentType: 'special',
      specialKind: 'special',
      specialNumber: null,
      matched: special[0],
      evidenceCode: 'special_marker',
    };
  }

  const movie = /(?:正片|剧场版|電影版|电影版)/u.exec(value);
  if (movie) {
    return {
      contentType: 'movie',
      specialKind: null,
      specialNumber: null,
      matched: movie[0],
      evidenceCode: 'movie_marker',
    };
  }

  return null;
}

function extractNumericIdentity(value: string): NumericMatch | null {
  const seasonEpisode = /S\s*0*(\d{1,3})\s*E(?:P)?\s*0*(\d{1,5})(?!\d)/iu.exec(value);
  if (seasonEpisode) {
    const season = Number(seasonEpisode[1]);
    const episode = Number(seasonEpisode[2]);
    if (season > 0 && validPositiveEpisodeNumber(episode)) {
      return {
        number: episode,
        kind: 'episode',
        season,
        matched: seasonEpisode[0],
        confidence: 'high',
        evidenceCode: 'explicit_season_episode',
      };
    }
  }

  const explicitEpisode = new RegExp(`第\\s*(${NUMBER_TOKEN})\\s*(集|话)`, 'iu').exec(value);
  if (explicitEpisode) {
    const number = toNumber(explicitEpisode[1] ?? '');
    if (number !== null) {
      return {
        number,
        kind: 'episode',
        season: null,
        matched: explicitEpisode[0],
        confidence: 'high',
        evidenceCode: 'explicit_episode_label',
      };
    }
  }

  const explicitIssue = new RegExp(`第\\s*(${NUMBER_TOKEN})\\s*期`, 'iu').exec(value);
  if (explicitIssue) {
    const number = toNumber(explicitIssue[1] ?? '');
    if (number !== null) {
      return {
        number,
        kind: 'issue',
        season: null,
        matched: explicitIssue[0],
        confidence: 'high',
        evidenceCode: 'explicit_issue_label',
      };
    }
  }

  const shortEpisode = /(?:^|[^A-Z\d])(?:EP|E)\s*0*(\d{1,5})(?![A-Z\d])/iu.exec(value);
  if (shortEpisode) {
    const number = Number(shortEpisode[1]);
    if (validPositiveEpisodeNumber(number)) {
      return {
        number,
        kind: 'episode',
        season: null,
        matched: shortEpisode[0].trim(),
        confidence: 'high',
        evidenceCode: 'short_episode_label',
      };
    }
  }

  const suffixEpisode = /(?:^|[^\d])(\d{1,5})\s*(集|话)(?![集话])/u.exec(value);
  if (suffixEpisode) {
    const number = Number(suffixEpisode[1]);
    if (validPositiveEpisodeNumber(number)) {
      return {
        number,
        kind: 'episode',
        season: null,
        matched: suffixEpisode[0].trim(),
        confidence: 'high',
        evidenceCode: 'explicit_episode_label',
      };
    }
  }

  const pureNumeric = /^0*(\d{1,8})$/u.exec(value.trim());
  if (pureNumeric) {
    const number = Number(pureNumeric[1]);
    if (validPositiveEpisodeNumber(number) && !(number >= 1900 && number <= 2099)) {
      return {
        number,
        kind: 'episode',
        season: null,
        matched: pureNumeric[0],
        confidence: 'medium',
        evidenceCode: 'pure_numeric_label',
      };
    }
  }

  return null;
}

function episodeTitle(value: string, consumed: readonly string[]): string | null {
  let title = value;
  for (const token of consumed.filter(Boolean)) title = title.replace(token, ' ');
  title = title.replace(TECHNICAL_TOKEN_PATTERN, ' ').replace(/[-–—_|/]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  return title.length >= 2 ? title : null;
}

function technicalOnly(value: string): boolean {
  const remaining = value.replace(TECHNICAL_TOKEN_PATTERN, ' ').replace(/[\s._\-()[\]（）【】]+/gu, '');
  return value.trim() !== '' && remaining === '';
}

export function parseEpisode(
  rawName: string,
  options: EpisodeParserOptions = {},
): ParsedEpisodeInfo {
  const raw = String(rawName ?? '');
  const value = raw.normalize('NFKC').trim();
  const evidence: EpisodeParseEvidence[] = [];
  const uncertainTokens: string[] = [];
  const date = extractBroadcastDate(value);
  const part = extractPart(value);
  const marker = extractContentMarker(value);
  const numeric = date ? null : extractNumericIdentity(value);

  if (date) {
    evidence.push({
      code: 'broadcast_date',
      token: date.matched,
      reason: 'A valid calendar date identifies this item and is not an episode number',
    });
  }
  if (part) {
    evidence.push({ code: 'part_marker', token: part.matched, reason: 'An explicit part marker was found' });
  }
  if (marker) {
    evidence.push({
      code: marker.evidenceCode,
      token: marker.matched,
      reason: `The item is explicitly marked as ${marker.contentType}`,
    });
  }
  if (numeric) {
    evidence.push({
      code: numeric.evidenceCode,
      token: numeric.matched,
      reason: `Parsed an explicit ${numeric.kind} identity`,
    });
  }

  const isTechnicalOnly = technicalOnly(value);
  if (isTechnicalOnly) {
    evidence.push({
      code: 'ignored_technical_token',
      token: value,
      reason: 'Resolution, codec, language, or route labels cannot be episode numbers',
    });
  }

  let contentType: EpisodeContentType = marker?.contentType ?? 'unknown';
  if (!marker && numeric) contentType = 'regular';
  if (!marker && date) contentType = 'regular';
  if (!marker && isTechnicalOnly && options.mediaType === 'movie') contentType = 'movie';

  const nonRegularMarker = marker !== null && marker.contentType !== 'regular';
  const episodeNumber = nonRegularMarker || date ? null : numeric?.number ?? null;
  const numberKind: EpisodeNumberKind = date
    ? 'date'
    : marker?.contentType === 'special'
      ? 'special'
      : episodeNumber !== null
        ? numeric?.kind ?? 'episode'
        : 'none';
  const consumed = [date?.matched ?? '', marker?.matched ?? '', numeric?.matched ?? '', part?.matched ?? ''];

  if (nonRegularMarker && numeric) {
    uncertainTokens.push(numeric.matched);
  }
  if (part && !numeric && !date) {
    uncertainTokens.push(part.matched);
  }

  let confidence: EpisodeConfidence = 'none';
  if (date || marker || numeric?.confidence === 'high') confidence = 'high';
  else if (numeric) confidence = numeric.confidence;
  else if (part || isTechnicalOnly) confidence = 'low';

  if (evidence.length === 0) {
    evidence.push({ code: 'unrecognized', token: value, reason: 'No reliable episode identity was found' });
  }

  return {
    rawName: raw,
    contentType,
    seasonNumber: numeric?.season ?? null,
    episodeNumber,
    absoluteNumber: numeric?.kind === 'episode' && numeric.season === null ? numeric.number : null,
    specialNumber: marker?.specialNumber ?? null,
    specialKind: marker?.specialKind ?? null,
    airDate: date?.airDate ?? null,
    episodeTitle: episodeTitle(value, consumed),
    part: part?.part ?? null,
    numberKind,
    confidence,
    ambiguous:
      numeric?.evidenceCode === 'pure_numeric_label' ||
      (nonRegularMarker && numeric !== null) ||
      (part !== null && numeric === null && date === null) ||
      (marker?.contentType === 'special' && marker.specialNumber === null),
    evidence,
    uncertainTokens,
  };
}

export class EpisodeParser {
  parse(rawName: string, options: EpisodeParserOptions = {}): ParsedEpisodeInfo {
    return parseEpisode(rawName, options);
  }
}
