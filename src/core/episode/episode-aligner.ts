import type {
  EpisodeAlignmentEvidence,
  EpisodeAlignmentMapping,
  EpisodeAlignmentResult,
  EpisodeManualAnchor,
  EpisodeSequenceEntry,
  ParsedEpisodeInfo,
} from '../types/episode.js';
import { normalizeTitleForIdentity } from '../identity/title-parser.js';
import { parseEpisode } from './episode-parser.js';

interface MatchCandidate {
  readonly targetIndex: number;
  readonly rank: 1 | 2 | 3;
  readonly mappingState: 'confirmed' | 'supported' | 'uncertain';
  readonly evidence: readonly EpisodeAlignmentEvidence[];
}

function parseSequence(sequence: readonly EpisodeSequenceEntry[]): readonly ParsedEpisodeInfo[] {
  return sequence.map((entry) => typeof entry === 'string' ? parseEpisode(entry) : entry);
}

function normalizedEpisodeTitle(episode: ParsedEpisodeInfo): string {
  return episode.episodeTitle ? normalizeTitleForIdentity(episode.episodeTitle) : '';
}

function compatibleContentType(left: ParsedEpisodeInfo, right: ParsedEpisodeInfo): boolean {
  return left.contentType === 'unknown' ||
    right.contentType === 'unknown' ||
    left.contentType === right.contentType;
}

function compatibleSeason(left: ParsedEpisodeInfo, right: ParsedEpisodeInfo): boolean {
  return left.seasonNumber === null ||
    right.seasonNumber === null ||
    left.seasonNumber === right.seasonNumber;
}

function matchCandidate(
  source: ParsedEpisodeInfo,
  target: ParsedEpisodeInfo,
  targetIndex: number,
): MatchCandidate | null {
  if (!compatibleContentType(source, target)) return null;

  if (source.airDate !== null && target.airDate !== null && source.airDate === target.airDate) {
    return {
      targetIndex,
      rank: 3,
      mappingState: 'confirmed',
      evidence: [{
        code: 'exact_air_date',
        reason: `Both entries identify broadcast date ${source.airDate}`,
        targetIndex,
      }],
    };
  }

  if (
    source.absoluteNumber !== null &&
    target.absoluteNumber !== null &&
    source.absoluteNumber === target.absoluteNumber &&
    compatibleSeason(source, target)
  ) {
    return {
      targetIndex,
      rank: 3,
      mappingState: 'confirmed',
      evidence: [{
        code: 'exact_absolute_number',
        reason: `Both entries identify absolute episode ${source.absoluteNumber}`,
        targetIndex,
      }],
    };
  }

  if (
    source.episodeNumber !== null &&
    target.episodeNumber !== null &&
    source.episodeNumber === target.episodeNumber &&
    source.numberKind === target.numberKind &&
    compatibleSeason(source, target)
  ) {
    const isIssue = source.numberKind === 'issue';
    const seasonDescription = source.seasonNumber !== null && target.seasonNumber !== null
      ? ` in season ${source.seasonNumber}`
      : '';
    return {
      targetIndex,
      rank: 3,
      mappingState: 'confirmed',
      evidence: [{
        code: isIssue ? 'exact_issue_number' : 'exact_episode_number',
        reason: `Both entries identify ${isIssue ? 'issue' : 'episode'} ${source.episodeNumber}${seasonDescription}`,
        targetIndex,
      }],
    };
  }

  if (
    source.contentType === 'special' &&
    target.contentType === 'special' &&
    source.specialKind !== null &&
    source.specialKind === target.specialKind &&
    source.specialNumber !== null &&
    source.specialNumber === target.specialNumber
  ) {
    return {
      targetIndex,
      rank: 3,
      mappingState: 'confirmed',
      evidence: [{
        code: 'exact_special_identity',
        reason: `Both entries identify ${source.specialKind.toUpperCase()} ${source.specialNumber}`,
        targetIndex,
      }],
    };
  }

  const sourceTitle = normalizedEpisodeTitle(source);
  const targetTitle = normalizedEpisodeTitle(target);
  if (sourceTitle && sourceTitle === targetTitle) {
    const samePart = source.part !== null && source.part === target.part;
    return {
      targetIndex,
      rank: samePart ? 2 : 1,
      mappingState: samePart ? 'supported' : 'uncertain',
      evidence: [{
        code: 'exact_content_title',
        reason: samePart
          ? 'Episode titles and explicit part markers are equal'
          : 'Episode titles are equal, but title evidence alone cannot confirm an episode',
        targetIndex,
      }],
    };
  }

  return null;
}

function hasReliableIdentity(episode: ParsedEpisodeInfo): boolean {
  return episode.airDate !== null ||
    episode.episodeNumber !== null ||
    (
      episode.contentType === 'special' &&
      episode.specialKind !== null &&
      episode.specialNumber !== null
    );
}

function canInferBetweenAnchors(episode: ParsedEpisodeInfo): boolean {
  return !hasReliableIdentity(episode) &&
    episode.contentType === 'unknown' &&
    episode.numberKind === 'none' &&
    episode.part === null;
}

function unresolvedMapping(
  sourceIndex: number,
  source: ParsedEpisodeInfo,
  candidates: readonly MatchCandidate[],
): EpisodeAlignmentMapping {
  if (candidates.length === 0) {
    const reliable = hasReliableIdentity(source);
    return {
      sourceIndex,
      targetIndices: [],
      state: reliable ? 'unmatched' : 'uncertain',
      evidence: [{
        code: 'no_reliable_identity',
        reason: reliable
          ? 'The source has a reliable identity, but the target sequence has no compatible entry'
          : 'The source entry has no reliable episode identity',
        sourceIndex,
      }],
      alternatives: [],
    };
  }

  const alternatives = candidates.map((candidate) => candidate.targetIndex);
  return {
    sourceIndex,
    targetIndices: alternatives,
    state: 'uncertain',
    evidence: [{
      code: 'ambiguous_candidates',
      reason: candidates.length === 1
        ? 'Only episode-title evidence is available; title equality alone is not decisive'
        : `${candidates.length} target entries share the best available identity evidence`,
      sourceIndex,
    }, ...candidates.flatMap((candidate) => candidate.evidence)],
    alternatives,
  };
}

function automaticMapping(
  sourceIndex: number,
  source: ParsedEpisodeInfo,
  targets: readonly ParsedEpisodeInfo[],
): EpisodeAlignmentMapping {
  const candidates = targets
    .map((target, targetIndex) => matchCandidate(source, target, targetIndex))
    .filter((candidate): candidate is MatchCandidate => candidate !== null);

  const highestRank = candidates.reduce((rank, candidate) => Math.max(rank, candidate.rank), 0);
  const best = candidates.filter((candidate) => candidate.rank === highestRank);
  if (best.length !== 1) return unresolvedMapping(sourceIndex, source, best);

  const selected = best[0];
  if (!selected || selected.mappingState === 'uncertain') {
    return unresolvedMapping(sourceIndex, source, best);
  }

  return {
    sourceIndex,
    targetIndices: [selected.targetIndex],
    state: selected.mappingState,
    evidence: selected.evidence.map((evidence) => ({ ...evidence, sourceIndex })),
    alternatives: [],
  };
}

function normalizedAnchorTargets(anchor: EpisodeManualAnchor): readonly number[] {
  return [...new Set(anchor.targetIndices)].sort((left, right) => left - right);
}

function sameIndices(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function manualMappings(
  sourceLength: number,
  targetLength: number,
  anchors: readonly EpisodeManualAnchor[],
): {
  readonly mappings: ReadonlyMap<number, EpisodeAlignmentMapping>;
  readonly evidence: readonly EpisodeAlignmentEvidence[];
} {
  const mappings = new Map<number, EpisodeAlignmentMapping>();
  const evidence: EpisodeAlignmentEvidence[] = [];

  for (const anchor of anchors) {
    const targetIndices = normalizedAnchorTargets(anchor);
    const inBounds = anchor.sourceIndex >= 0 &&
      anchor.sourceIndex < sourceLength &&
      targetIndices.length > 0 &&
      targetIndices.every((index) => index >= 0 && index < targetLength);

    if (!inBounds) {
      evidence.push({
        code: 'anchor_conflict',
        reason: `Manual anchor ${anchor.sourceIndex} -> [${targetIndices.join(', ')}] is out of bounds`,
        sourceIndex: anchor.sourceIndex,
      });
      continue;
    }

    const existing = mappings.get(anchor.sourceIndex);
    if (existing && !sameIndices(existing.targetIndices, targetIndices)) {
      const conflict: EpisodeAlignmentMapping = {
        sourceIndex: anchor.sourceIndex,
        targetIndices: [],
        state: 'conflicting',
        evidence: [{
          code: 'anchor_conflict',
          reason: `Manual anchors assign source ${anchor.sourceIndex} to different targets`,
          sourceIndex: anchor.sourceIndex,
        }],
        alternatives: [...new Set([...existing.targetIndices, ...targetIndices])],
      };
      mappings.set(anchor.sourceIndex, conflict);
      evidence.push(...conflict.evidence);
      continue;
    }

    if (!existing) {
      mappings.set(anchor.sourceIndex, {
        sourceIndex: anchor.sourceIndex,
        targetIndices,
        state: 'confirmed',
        evidence: [{
          code: 'manual_anchor',
          reason: anchor.evidence?.trim() || 'A caller-provided manual anchor confirms this mapping',
          sourceIndex: anchor.sourceIndex,
          targetIndex: targetIndices.length === 1 ? targetIndices[0] : undefined,
        }],
        alternatives: [],
      });
    }
  }

  return { mappings, evidence };
}

function markOrderConflicts(
  mappings: readonly EpisodeAlignmentMapping[],
  sources: readonly ParsedEpisodeInfo[],
  targets: readonly ParsedEpisodeInfo[],
): {
  readonly mappings: readonly EpisodeAlignmentMapping[];
  readonly evidence: readonly EpisodeAlignmentEvidence[];
} {
  const conflicts = new Set<number>();
  const anchors = mappings
    .filter((mapping) => {
      const targetIndex = mapping.targetIndices[0];
      const source = sources[mapping.sourceIndex];
      const target = targetIndex === undefined ? undefined : targets[targetIndex];
      return mapping.state === 'confirmed' &&
        mapping.targetIndices.length === 1 &&
        source?.contentType === 'regular' &&
        target?.contentType === 'regular';
    })
    .map((mapping) => ({
      sourceIndex: mapping.sourceIndex,
      targetIndex: mapping.targetIndices[0] as number,
    }))
    .sort((left, right) => left.sourceIndex - right.sourceIndex);

  for (let index = 1; index < anchors.length; index += 1) {
    const previous = anchors[index - 1];
    const current = anchors[index];
    if (previous && current && current.targetIndex <= previous.targetIndex) {
      conflicts.add(previous.sourceIndex);
      conflicts.add(current.sourceIndex);
    }
  }

  if (conflicts.size === 0) return { mappings, evidence: [] };

  const evidence: EpisodeAlignmentEvidence[] = [...conflicts].map((sourceIndex) => ({
    code: 'anchor_conflict',
    reason: 'Reliable episode anchors reverse or duplicate target sequence order',
    sourceIndex,
  }));
  return {
    mappings: mappings.map((mapping) => conflicts.has(mapping.sourceIndex)
      ? {
          ...mapping,
          state: 'conflicting' as const,
          evidence: [...mapping.evidence, ...evidence.filter((item) => item.sourceIndex === mapping.sourceIndex)],
          alternatives: mapping.targetIndices,
          targetIndices: [],
        }
      : mapping),
    evidence,
  };
}

function inferBoundedMappings(
  mappings: readonly EpisodeAlignmentMapping[],
  sources: readonly ParsedEpisodeInfo[],
  targets: readonly ParsedEpisodeInfo[],
): readonly EpisodeAlignmentMapping[] {
  const result = [...mappings];
  const anchors = result
    .filter((mapping) => mapping.state === 'confirmed' && mapping.targetIndices.length === 1)
    .map((mapping) => ({
      sourceIndex: mapping.sourceIndex,
      targetIndex: mapping.targetIndices[0] as number,
    }))
    .sort((left, right) => left.sourceIndex - right.sourceIndex);
  const usedTargets = new Set(
    result
      .filter((mapping) => mapping.state === 'confirmed' || mapping.state === 'supported')
      .flatMap((mapping) => mapping.targetIndices),
  );

  for (let anchorIndex = 1; anchorIndex < anchors.length; anchorIndex += 1) {
    const left = anchors[anchorIndex - 1];
    const right = anchors[anchorIndex];
    if (!left || !right || right.targetIndex <= left.targetIndex) continue;

    const sourceIndices = Array.from(
      { length: Math.max(0, right.sourceIndex - left.sourceIndex - 1) },
      (_, offset) => left.sourceIndex + offset + 1,
    );
    const targetIndices = Array.from(
      { length: Math.max(0, right.targetIndex - left.targetIndex - 1) },
      (_, offset) => left.targetIndex + offset + 1,
    ).filter((targetIndex) => !usedTargets.has(targetIndex));

    if (sourceIndices.length === 0 || sourceIndices.length !== targetIndices.length) continue;
    const inferable = sourceIndices.every((sourceIndex) => {
      const mapping = result[sourceIndex];
      const source = sources[sourceIndex];
      return mapping?.state === 'uncertain' && source !== undefined && canInferBetweenAnchors(source);
    }) && targetIndices.every((targetIndex) => {
      const target = targets[targetIndex];
      return target !== undefined && canInferBetweenAnchors(target);
    });
    if (!inferable) continue;

    sourceIndices.forEach((sourceIndex, offset) => {
      const targetIndex = targetIndices[offset];
      if (targetIndex === undefined) return;
      result[sourceIndex] = {
        sourceIndex,
        targetIndices: [targetIndex],
        state: 'supported',
        evidence: [{
          code: 'bounded_by_two_anchors',
          reason: `Order is bounded by reliable mappings ${left.sourceIndex}->${left.targetIndex} and ${right.sourceIndex}->${right.targetIndex}`,
          sourceIndex,
          targetIndex,
        }],
        alternatives: [],
      };
      usedTargets.add(targetIndex);
    });
  }

  return result;
}

export function alignEpisodeSequences(
  sourceSequence: readonly EpisodeSequenceEntry[],
  targetSequence: readonly EpisodeSequenceEntry[],
  anchors: readonly EpisodeManualAnchor[] = [],
): EpisodeAlignmentResult {
  const sources = parseSequence(sourceSequence);
  const targets = parseSequence(targetSequence);
  const manual = manualMappings(sources.length, targets.length, anchors);
  const initial = sources.map((source, sourceIndex) =>
    manual.mappings.get(sourceIndex) ?? automaticMapping(sourceIndex, source, targets));
  const ordered = markOrderConflicts(initial, sources, targets);
  const mappings = ordered.evidence.length === 0
    ? inferBoundedMappings(ordered.mappings, sources, targets)
    : ordered.mappings;
  const evidence = [
    ...manual.evidence,
    ...ordered.evidence,
    ...mappings.flatMap((mapping) => mapping.evidence),
  ];
  const reliableAnchorCount = mappings.filter(
    (mapping) => mapping.state === 'confirmed' && mapping.targetIndices.length > 0,
  ).length;
  const hasConflict = manual.evidence.some((item) => item.code === 'anchor_conflict') ||
    mappings.some((mapping) => mapping.state === 'conflicting');
  const mappedCount = mappings.filter(
    (mapping) => mapping.state === 'confirmed' || mapping.state === 'supported',
  ).length;

  return {
    state: hasConflict
      ? 'conflicting'
      : mappings.length > 0 && mappedCount === mappings.length
        ? 'aligned'
        : mappedCount > 0
          ? 'partial'
          : 'uncertain',
    mappings,
    reliableAnchorCount,
    evidence,
  };
}

export class EpisodeAligner {
  align(
    sourceSequence: readonly EpisodeSequenceEntry[],
    targetSequence: readonly EpisodeSequenceEntry[],
    anchors: readonly EpisodeManualAnchor[] = [],
  ): EpisodeAlignmentResult {
    return alignEpisodeSequences(sourceSequence, targetSequence, anchors);
  }
}
