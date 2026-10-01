import type {
  ParsedTitle,
  TitleInterpretation,
  TitleTokenSource,
} from '../types/identity.js';

const CHINESE_DIGITS: Readonly<Record<string, number>> = {
  '零': 0,
  '〇': 0,
  '一': 1,
  '二': 2,
  '两': 2,
  '三': 3,
  '四': 4,
  '五': 5,
  '六': 6,
  '七': 7,
  '八': 8,
  '九': 9,
};

const CHINESE_UNITS: Readonly<Record<string, number>> = {
  '十': 10,
  '百': 100,
  '千': 1000,
};

const EDITION_PATTERN =
  /(?:未删减(?:版)?|完整(?:版)?|导演剪辑(?:版)?|加长(?:版)?|重制(?:版)?|修复(?:版)?|蓝光(?:版)?|(?:4K|8K)(?:版)?|杜比(?:版)?|国语(?:版)?|粤语(?:版)?|中字(?:版)?|双语(?:版)?)/giu;

const SEASON_TOKEN_PATTERN = '[〇零一二两三四五六七八九十百\\d]+';

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    const key = normalizeTitleForIdentity(trimmed);
    if (trimmed && key && !seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
  }

  return result;
}

export function parseChineseNumberToken(value: string): number | null {
  const token = value.normalize('NFKC').trim();
  if (/^\d+$/.test(token)) {
    const number = Number(token);
    return Number.isSafeInteger(number) ? number : null;
  }

  if (!token || !/^[〇零一二两三四五六七八九十百千]+$/u.test(token)) {
    return null;
  }

  if (!/[十百千]/u.test(token)) {
    const digits = [...token].map((character) => CHINESE_DIGITS[character]);
    if (digits.some((digit) => digit === undefined)) return null;
    const number = Number(digits.join(''));
    return Number.isSafeInteger(number) ? number : null;
  }

  let total = 0;
  let currentDigit = 0;
  for (const character of token) {
    const digit = CHINESE_DIGITS[character];
    if (digit !== undefined) {
      currentDigit = digit;
      continue;
    }

    const unit = CHINESE_UNITS[character];
    if (unit === undefined) return null;
    total += (currentDigit || 1) * unit;
    currentDigit = 0;
  }

  return total + currentDigit;
}

export function normalizeTitleForIdentity(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s\-_.·•:：,，/\\|()（）[\]【】《》"'“”‘’]+/gu, '');
}

function compactTitle(value: string): string {
  return value
    .replace(/\s+/gu, ' ')
    .replace(/^[-–—:：|/\s]+|[-–—:：|/\s]+$/gu, '')
    .trim();
}

interface ExtractedToken {
  readonly value: number;
  readonly source: TitleTokenSource;
  readonly matched: string;
}

function extractSeason(value: string): ExtractedToken | null {
  const chinese = new RegExp(`第\\s*(${SEASON_TOKEN_PATTERN})\\s*季`, 'iu').exec(value);
  if (chinese) {
    const number = parseChineseNumberToken(chinese[1] ?? '');
    if (number !== null && number > 0) {
      return {
        value: number,
        source: 'explicit_chinese_season',
        matched: chinese[0],
      };
    }
  }

  const english = /\bSeason\s*0*(\d{1,3})\b/iu.exec(value);
  if (english) {
    const number = Number(english[1]);
    if (number > 0) {
      return {
        value: number,
        source: 'explicit_english_season',
        matched: english[0],
      };
    }
  }

  const shortCode = /S\s*0*(\d{1,3})(?![\dA-Z])/iu.exec(value);
  if (shortCode) {
    const number = Number(shortCode[1]);
    if (number > 0) {
      return {
        value: number,
        source: 'explicit_s_code',
        matched: shortCode[0],
      };
    }
  }

  return null;
}

function extractYear(value: string): ExtractedToken | null {
  const bracketed = /[（(\[【]\s*((?:19|20)\d{2})\s*[）)\]】]/u.exec(value);
  if (bracketed) {
    return {
      value: Number(bracketed[1]),
      source: 'explicit_year',
      matched: bracketed[0],
    };
  }

  const separatedSuffix = /\s+((?:19|20)\d{2})\s*$/u.exec(value);
  if (separatedSuffix) {
    return {
      value: Number(separatedSuffix[1]),
      source: 'explicit_year',
      matched: separatedSuffix[0],
    };
  }

  return null;
}

function stripEditionMarkers(value: string): {
  readonly title: string;
  readonly markers: readonly string[];
} {
  const markers: string[] = [];
  const title = value.replace(EDITION_PATTERN, (match) => {
    markers.push(match);
    return ' ';
  });
  return { title, markers: uniqueStrings(markers) };
}

function splitTitleAndAliases(value: string): readonly string[] {
  return value
    .replace(/\s+又名\s*[:：]?\s*/gu, '|')
    .split(/\s*[|｜]\s*|\s+[／/]\s+/gu)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseTitle(rawTitle: string): ParsedTitle {
  const raw = String(rawTitle ?? '');
  const normalizedRaw = raw.normalize('NFKC').trim();
  const titleParts = splitTitleAndAliases(normalizedRaw);
  const primary = titleParts[0] ?? normalizedRaw;

  const seasonToken = extractSeason(primary);
  const yearToken = extractYear(primary);

  let cleanedPrimary = primary;
  if (seasonToken) cleanedPrimary = cleanedPrimary.replace(seasonToken.matched, ' ');
  if (yearToken) cleanedPrimary = cleanedPrimary.replace(yearToken.matched, ' ');

  const primaryEdition = stripEditionMarkers(cleanedPrimary);
  const baseTitle = compactTitle(primaryEdition.title) || compactTitle(primary);

  const aliasResults = titleParts.slice(1).map((alias) => {
    const withoutSeason = extractSeason(alias);
    const withoutYear = extractYear(alias);
    let cleaned = alias;
    if (withoutSeason) cleaned = cleaned.replace(withoutSeason.matched, ' ');
    if (withoutYear) cleaned = cleaned.replace(withoutYear.matched, ' ');
    return stripEditionMarkers(cleaned);
  });
  const aliases = uniqueStrings(aliasResults.map((result) => compactTitle(result.title)));
  const editionMarkers = uniqueStrings([
    ...primaryEdition.markers,
    ...aliasResults.flatMap((result) => result.markers),
  ]);

  const uncertainTokens: string[] = [];
  const trailingNumber = /(?:^|[^\d])((?:\d{1,3}))\s*$/u.exec(baseTitle);
  if (!seasonToken && trailingNumber?.[1]) uncertainTokens.push(trailingNumber[1]);

  const partMarker = /(?:第\s*[〇零一二两三四五六七八九十百\d]+\s*部|\bPart\s*\d+\b)/iu.exec(baseTitle);
  if (!seasonToken && partMarker) uncertainTokens.push(partMarker[0]);

  const interpretations: TitleInterpretation[] = [
    {
      baseTitle,
      season: seasonToken?.value ?? null,
      confidence: seasonToken ? 'high' : 'medium',
      source: seasonToken?.source ?? 'literal_title',
    },
  ];

  if (!seasonToken && trailingNumber?.[1]) {
    const possibleSeason = Number(trailingNumber[1]);
    const stripped = compactTitle(baseTitle.slice(0, Math.max(0, baseTitle.length - trailingNumber[1].length)));
    if (stripped && possibleSeason > 0 && possibleSeason <= 99) {
      interpretations.push({
        baseTitle: stripped,
        season: possibleSeason,
        confidence: 'low',
        source: 'trailing_number',
      });
    }
  }

  return {
    rawTitle: raw,
    baseTitle,
    normalizedBaseTitle: normalizeTitleForIdentity(baseTitle),
    aliases,
    season: seasonToken?.value ?? null,
    seasonSource: seasonToken?.source ?? null,
    year: yearToken?.value ?? null,
    yearSource: yearToken?.source ?? null,
    editionMarkers,
    uncertainTokens: uniqueStrings(uncertainTokens),
    interpretations,
  };
}

export class TitleParser {
  parse(rawTitle: string): ParsedTitle {
    return parseTitle(rawTitle);
  }
}
