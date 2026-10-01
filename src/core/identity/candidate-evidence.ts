import type {
  CandidateEvidence,
  MediaIdentityInput,
  ParsedTitle,
} from '../types/identity.js';
import { normalizeTitleForIdentity, parseTitle } from './title-parser.js';

interface PreparedIdentity {
  readonly input: MediaIdentityInput;
  readonly title: ParsedTitle;
  readonly titleValues: ReadonlyMap<string, 'title' | 'alias'>;
  readonly year: number | null;
  readonly season: number | null;
}

function normalizeComparable(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s\-_.·•:：,，/\\|()（）[\]【】"'“”‘’]+/gu, '');
}

function normalizeValues(values: readonly string[] | undefined): ReadonlySet<string> {
  return new Set((values ?? []).map(normalizeComparable).filter(Boolean));
}

function titleValues(input: MediaIdentityInput, title: ParsedTitle): ReadonlyMap<string, 'title' | 'alias'> {
  const result = new Map<string, 'title' | 'alias'>();
  const primary = normalizeTitleForIdentity(title.baseTitle);
  if (primary) result.set(primary, 'title');
  for (const alias of [...title.aliases, ...(input.aliases ?? [])]) {
    const normalized = normalizeTitleForIdentity(alias);
    if (normalized && !result.has(normalized)) result.set(normalized, 'alias');
  }
  return result;
}

function prepare(input: MediaIdentityInput): PreparedIdentity {
  const title = input.parsedTitle ?? parseTitle(input.rawTitle);
  return {
    input,
    title,
    titleValues: titleValues(input, title),
    year: input.year !== undefined ? input.year : title.year,
    season: input.season !== undefined ? input.season : title.season,
  };
}

function unknown(field: CandidateEvidence['field'], reason: string, left: unknown, right: unknown): CandidateEvidence {
  return { field, state: 'unknown', reason, leftValue: left, rightValue: right };
}

function compareTitle(left: PreparedIdentity, right: PreparedIdentity): CandidateEvidence {
  for (const [value, leftKind] of left.titleValues) {
    const rightKind = right.titleValues.get(value);
    if (rightKind) {
      const field = leftKind === 'alias' || rightKind === 'alias' ? 'alias' : 'title';
      return {
        field,
        state: 'supporting',
        reason: field === 'title' ? 'Normalized base titles are equal' : 'A declared title or alias is shared',
        leftValue: left.title.baseTitle,
        rightValue: right.title.baseTitle,
      };
    }
  }

  if (!left.title.normalizedBaseTitle || !right.title.normalizedBaseTitle) {
    return unknown('title', 'At least one title is empty after normalization', left.title.rawTitle, right.title.rawTitle);
  }

  return {
    field: 'title',
    state: 'conflicting',
    reason: 'No normalized base title or declared alias is shared',
    leftValue: left.title.baseTitle,
    rightValue: right.title.baseTitle,
  };
}

function compareOptionalNumber(
  field: 'year' | 'season',
  left: number | null,
  right: number | null,
): CandidateEvidence {
  if (left === null || right === null) {
    return unknown(field, `${field} is unknown on at least one side`, left, right);
  }
  if (left === right) {
    return {
      field,
      state: 'supporting',
      reason: `${field} values are equal`,
      leftValue: left,
      rightValue: right,
    };
  }
  if (field === 'year' && Math.abs(left - right) === 1) {
    return unknown(
      field,
      'One-year differences can be broadcast, import, or edition metadata and are not decisive',
      left,
      right,
    );
  }
  return {
    field,
    state: 'conflicting',
    reason: `${field} values explicitly differ`,
    leftValue: left,
    rightValue: right,
  };
}

function compareMediaType(left: PreparedIdentity, right: PreparedIdentity): CandidateEvidence {
  const leftType = left.input.mediaType ?? 'unknown';
  const rightType = right.input.mediaType ?? 'unknown';
  if (leftType === 'unknown' || rightType === 'unknown') {
    return unknown('mediaType', 'Media type is unknown on at least one side', leftType, rightType);
  }
  return {
    field: 'mediaType',
    state: leftType === rightType ? 'supporting' : 'conflicting',
    reason: leftType === rightType ? 'Media types are equal' : 'Known media types explicitly differ',
    leftValue: leftType,
    rightValue: rightType,
  };
}

function comparePeople(
  field: 'director' | 'actors',
  leftValues: readonly string[] | undefined,
  rightValues: readonly string[] | undefined,
): CandidateEvidence {
  const left = normalizeValues(leftValues);
  const right = normalizeValues(rightValues);
  if (left.size === 0 || right.size === 0) {
    return unknown(field, `${field} metadata is missing on at least one side`, leftValues ?? [], rightValues ?? []);
  }
  const shared = [...left].filter((value) => right.has(value));
  if (shared.length === 0) {
    return unknown(
      field,
      `No normalized ${field} value is shared; incomplete upstream credits cannot prove a conflict`,
      leftValues,
      rightValues,
    );
  }
  return {
    field,
    state: 'supporting',
    reason: `${shared.length} normalized ${field} value(s) are shared`,
    leftValue: leftValues,
    rightValue: rightValues,
  };
}

function compareDescriptiveList(
  field: 'area' | 'language',
  leftValues: readonly string[] | undefined,
  rightValues: readonly string[] | undefined,
): CandidateEvidence {
  const left = normalizeValues(leftValues);
  const right = normalizeValues(rightValues);
  if (left.size === 0 || right.size === 0) {
    return unknown(field, `${field} metadata is missing on at least one side`, leftValues ?? [], rightValues ?? []);
  }
  const shared = [...left].filter((value) => right.has(value));
  return shared.length > 0
    ? {
        field,
        state: 'supporting',
        reason: `A normalized ${field} value is shared`,
        leftValue: leftValues,
        rightValue: rightValues,
      }
    : unknown(
        field,
        `${field} labels differ but are not authoritative identity blockers`,
        leftValues,
        rightValues,
      );
}

function compareExternalIds(left: PreparedIdentity, right: PreparedIdentity): readonly CandidateEvidence[] {
  const leftIds = left.input.externalIds ?? {};
  const rightIds = right.input.externalIds ?? {};
  const sharedProviders = Object.keys(leftIds).filter((provider) => rightIds[provider] !== undefined);
  if (sharedProviders.length === 0) {
    return [unknown('externalId', 'No external ID namespace is shared', leftIds, rightIds)];
  }

  return sharedProviders.map((provider) => {
    const leftValue = String(leftIds[provider] ?? '').trim();
    const rightValue = String(rightIds[provider] ?? '').trim();
    const equal = leftValue !== '' && leftValue === rightValue;
    return {
      field: 'externalId',
      state: equal ? 'confirmed' : 'conflicting',
      reason: equal
        ? `Verified ${provider} IDs are equal`
        : `Verified ${provider} IDs explicitly differ`,
      leftValue,
      rightValue,
      source: provider,
    };
  });
}

function compareKnownRelation(left: PreparedIdentity, right: PreparedIdentity): CandidateEvidence {
  const leftRejectsRight =
    right.input.recordId !== undefined && left.input.knownDifferentFrom?.includes(right.input.recordId);
  const rightRejectsLeft =
    left.input.recordId !== undefined && right.input.knownDifferentFrom?.includes(left.input.recordId);
  if (leftRejectsRight || rightRejectsLeft) {
    return {
      field: 'knownRelation',
      state: 'conflicting',
      reason: 'A verified relation marks these records as different works',
      leftValue: left.input.recordId ?? null,
      rightValue: right.input.recordId ?? null,
    };
  }
  return unknown(
    'knownRelation',
    'No verified same/different relation is available',
    left.input.recordId ?? null,
    right.input.recordId ?? null,
  );
}

export function collectCandidateEvidence(
  leftInput: MediaIdentityInput,
  rightInput: MediaIdentityInput,
): readonly CandidateEvidence[] {
  const left = prepare(leftInput);
  const right = prepare(rightInput);
  return [
    compareKnownRelation(left, right),
    ...compareExternalIds(left, right),
    compareTitle(left, right),
    compareOptionalNumber('year', left.year, right.year),
    compareOptionalNumber('season', left.season, right.season),
    compareMediaType(left, right),
    comparePeople('director', left.input.directors, right.input.directors),
    comparePeople('actors', left.input.actors, right.input.actors),
    compareDescriptiveList('area', left.input.areas, right.input.areas),
    compareDescriptiveList('language', left.input.languages, right.input.languages),
  ];
}

export class CandidateEvidenceCollector {
  collect(left: MediaIdentityInput, right: MediaIdentityInput): readonly CandidateEvidence[] {
    return collectCandidateEvidence(left, right);
  }
}
