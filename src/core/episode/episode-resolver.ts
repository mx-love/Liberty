import type {
  CanonicalEpisode,
  EpisodeAlignmentEvidence,
  EpisodeAlignmentResult,
  EpisodeManualAnchor,
  EpisodeResolution,
  EpisodeResolutionCandidate,
  EpisodeResolutionEvidence,
  EpisodeResolutionInput,
  EpisodeResolutionState,
  ParsedEpisodeInfo,
} from '../types/episode.js';
import type { SourceEpisode } from '../types/source.js';
import { alignEpisodeSequences } from './episode-aligner.js';
import { parseEpisode } from './episode-parser.js';

interface VerifiedMappingPreparation {
  readonly anchors: readonly EpisodeManualAnchor[];
  readonly rejectionReasons: readonly string[];
}

function sameSourceCoordinate(left: SourceEpisode, right: SourceEpisode): boolean {
  const samePosition = left.sourceKey === right.sourceKey &&
    left.vodId === right.vodId &&
    left.playGroup === right.playGroup &&
    left.playGroupIndex === right.playGroupIndex &&
    left.rawIndex === right.rawIndex;
  if (!samePosition) return false;

  const leftName = left.rawEpisodeName.trim();
  const rightName = right.rawEpisodeName.trim();
  return leftName || rightName
    ? left.rawEpisodeName === right.rawEpisodeName
    : left.rawEntry === right.rawEntry;
}

function matchingSourceIndices(
  sourceEpisode: SourceEpisode,
  sourceSequence: readonly SourceEpisode[],
): readonly number[] {
  return sourceSequence.flatMap((candidate, index) =>
    sameSourceCoordinate(candidate, sourceEpisode) ? [index] : []);
}

function canonicalAsParsedEpisode(episode: CanonicalEpisode): ParsedEpisodeInfo {
  const parsedTitle = parseEpisode(episode.episodeTitle ?? '');
  const contentType = episode.contentType === 'unknown'
    ? parsedTitle.contentType
    : episode.contentType;
  const seasonNumber = episode.seasonNumber ?? parsedTitle.seasonNumber;
  const episodeNumber = episode.episodeNumber ?? parsedTitle.episodeNumber;
  const absoluteNumber = episode.absoluteNumber ?? parsedTitle.absoluteNumber;
  const airDate = episode.airDate ?? parsedTitle.airDate;
  const part = episode.part ?? parsedTitle.part;
  const isSpecial = contentType === 'special';
  const hasNumber = episodeNumber !== null || absoluteNumber !== null;
  return {
    ...parsedTitle,
    rawName: episode.episodeTitle ?? episode.canonicalEpisodeId,
    contentType,
    seasonNumber,
    episodeNumber,
    absoluteNumber,
    specialNumber: isSpecial
      ? parsedTitle.specialNumber ?? episodeNumber ?? absoluteNumber
      : null,
    specialKind: isSpecial ? parsedTitle.specialKind ?? 'special' : null,
    airDate,
    episodeTitle: episode.episodeTitle ?? parsedTitle.episodeTitle,
    part,
    numberKind: airDate !== null
      ? 'date'
      : isSpecial
        ? 'special'
        : parsedTitle.numberKind !== 'none'
          ? parsedTitle.numberKind
          : hasNumber
            ? 'episode'
            : 'none',
    confidence: parsedTitle.confidence !== 'none' || hasNumber || isSpecial
      ? 'high'
      : 'none',
    ambiguous: parsedTitle.ambiguous,
  };
}

function prepareVerifiedMappings(input: EpisodeResolutionInput): VerifiedMappingPreparation {
  const anchors: EpisodeManualAnchor[] = [];
  const rejectionReasons: string[] = [];

  for (const mapping of input.verifiedMappings ?? []) {
    const sourceIndices = matchingSourceIndices(mapping.sourceEpisode, input.sourceSequence);
    if (sourceIndices.length !== 1) {
      rejectionReasons.push(
        sourceIndices.length === 0
          ? 'A verified mapping references a source episode outside the supplied source sequence'
          : 'A verified mapping does not uniquely identify one source episode in the supplied sequence',
      );
      continue;
    }

    const canonicalIds = [...new Set(mapping.canonicalEpisodeIds)];
    if (canonicalIds.length === 0) {
      rejectionReasons.push('A verified mapping must name at least one canonical episode');
      continue;
    }

    const targetIndices: number[] = [];
    for (const canonicalEpisodeId of canonicalIds) {
      const matches = input.candidateEpisodes.flatMap((episode, index) =>
        episode.canonicalEpisodeId === canonicalEpisodeId ? [index] : []);
      if (matches.length !== 1) {
        rejectionReasons.push(
          matches.length === 0
            ? `Verified canonical episode ${canonicalEpisodeId} is absent from the candidate sequence`
            : `Verified canonical episode ${canonicalEpisodeId} is duplicated in the candidate sequence`,
        );
        continue;
      }
      const targetIndex = matches[0];
      if (targetIndex !== undefined) targetIndices.push(targetIndex);
    }

    if (targetIndices.length !== canonicalIds.length) continue;
    const sourceIndex = sourceIndices[0];
    if (sourceIndex === undefined) continue;
    anchors.push({
      sourceIndex,
      targetIndices,
      evidence: mapping.evidence?.trim() || 'A caller-provided verified mapping confirms this identity',
    });
  }

  return { anchors, rejectionReasons };
}

function alignmentEvidence(
  evidence: readonly EpisodeAlignmentEvidence[],
  candidateEpisodes: readonly CanonicalEpisode[],
): readonly EpisodeResolutionEvidence[] {
  return evidence.map((item) => ({
    ...item,
    canonicalEpisodeId: item.targetIndex === undefined
      ? undefined
      : candidateEpisodes[item.targetIndex]?.canonicalEpisodeId,
  }));
}

function candidateResults(
  candidateEpisodes: readonly CanonicalEpisode[],
  targetIndices: readonly number[],
  state: EpisodeResolutionCandidate['state'],
  evidence: readonly EpisodeResolutionEvidence[],
  rejectionReasons: readonly string[] = [],
): readonly EpisodeResolutionCandidate[] {
  return [...new Set(targetIndices)].flatMap((targetIndex) => {
    const episode = candidateEpisodes[targetIndex];
    if (!episode) return [];
    const candidateEvidence = evidence.filter((item) =>
      item.targetIndex === undefined || item.targetIndex === targetIndex);
    return [{ episode, state, evidence: candidateEvidence, rejectionReasons }];
  });
}

function explicitSeasonConflict(
  source: ParsedEpisodeInfo,
  candidates: readonly CanonicalEpisode[],
): readonly number[] {
  if (source.seasonNumber === null) return [];
  return candidates.flatMap((candidate, index) => {
    if (candidate.seasonNumber === null || candidate.seasonNumber === source.seasonNumber) return [];
    const sameEpisodeNumber = source.episodeNumber !== null &&
      candidate.episodeNumber !== null &&
      source.episodeNumber === candidate.episodeNumber;
    const sameAbsoluteNumber = source.absoluteNumber !== null &&
      candidate.absoluteNumber !== null &&
      source.absoluteNumber === candidate.absoluteNumber;
    return sameEpisodeNumber || sameAbsoluteNumber ? [index] : [];
  });
}

function rejectedResult(
  input: EpisodeResolutionInput,
  alignment: EpisodeAlignmentResult,
  targetIndices: readonly number[],
  evidence: readonly EpisodeResolutionEvidence[],
  rejectionReasons: readonly string[],
): EpisodeResolution {
  return {
    state: 'rejected',
    sourceEpisode: input.sourceEpisode,
    selectedEpisode: null,
    candidates: candidateResults(
      input.candidateEpisodes,
      targetIndices,
      'rejected',
      evidence,
      rejectionReasons,
    ),
    evidence,
    rejectionReasons,
    alignment,
    reason: rejectionReasons.join('; ') || 'Episode resolution evidence is conflicting',
  };
}

function mappedResult(
  input: EpisodeResolutionInput,
  alignment: EpisodeAlignmentResult,
  targetIndices: readonly number[],
  state: Extract<EpisodeResolutionState, 'verified' | 'supported'>,
  evidence: readonly EpisodeResolutionEvidence[],
): EpisodeResolution {
  const candidates = candidateResults(input.candidateEpisodes, targetIndices, state, evidence);
  return {
    state,
    sourceEpisode: input.sourceEpisode,
    selectedEpisode: candidates.length === 1 ? candidates[0]?.episode ?? null : null,
    candidates,
    evidence,
    rejectionReasons: [],
    alignment,
    reason: state === 'verified'
      ? 'A validated caller-provided mapping verifies the canonical episode identity'
      : 'Reliable episode identity or bounded sequence evidence supports the canonical episode',
  };
}

export function resolveEpisode(input: EpisodeResolutionInput): EpisodeResolution {
  const sourceEntries = input.sourceSequence.map((episode) => episode.parsedEpisodeInfo);
  const targetEntries = input.candidateEpisodes.map(canonicalAsParsedEpisode);
  const verified = prepareVerifiedMappings(input);
  const alignment = alignEpisodeSequences(sourceEntries, targetEntries, verified.anchors);
  const sourceIndices = matchingSourceIndices(input.sourceEpisode, input.sourceSequence);
  const sourceIndex = sourceIndices.length === 1 ? sourceIndices[0] : undefined;
  const membershipEvidence: EpisodeResolutionEvidence = {
    code: sourceIndices.length === 1
      ? 'source_sequence_membership'
      : 'verified_mapping_conflict',
    reason: sourceIndices.length === 1
      ? 'The current source episode is uniquely present in the complete source sequence'
      : sourceIndices.length === 0
        ? 'The current source episode is absent from the supplied source sequence'
        : 'The current source episode coordinate is duplicated in the supplied source sequence',
    sourceIndex,
  };

  if (sourceIndex === undefined) {
    return rejectedResult(input, alignment, [], [membershipEvidence], [membershipEvidence.reason]);
  }

  const mediaConflictIndices = input.candidateEpisodes.flatMap((episode, index) =>
    episode.mediaId === input.canonicalMedia.mediaId ? [] : [index]);
  if (mediaConflictIndices.length > 0) {
    const reasons = mediaConflictIndices.map((index) => {
      const episode = input.candidateEpisodes[index];
      return `Candidate ${episode?.canonicalEpisodeId ?? index} belongs to media ${episode?.mediaId ?? 'unknown'}, not ${input.canonicalMedia.mediaId}`;
    });
    const evidence: EpisodeResolutionEvidence[] = [membershipEvidence, ...mediaConflictIndices.map((index, reasonIndex) => ({
      code: 'canonical_media_conflict' as const,
      reason: reasons[reasonIndex] ?? 'Candidate media identity conflicts',
      canonicalEpisodeId: input.candidateEpisodes[index]?.canonicalEpisodeId,
      targetIndex: index,
    }))];
    return rejectedResult(input, alignment, mediaConflictIndices, evidence, reasons);
  }

  const canonicalSeasonConflicts = input.canonicalMedia.season === null
    ? []
    : input.candidateEpisodes.flatMap((episode, index) =>
        episode.seasonNumber !== null && episode.seasonNumber !== input.canonicalMedia.season ? [index] : []);
  if (canonicalSeasonConflicts.length > 0) {
    const reasons = canonicalSeasonConflicts.map((index) =>
      `Candidate ${input.candidateEpisodes[index]?.canonicalEpisodeId ?? index} declares season ${input.candidateEpisodes[index]?.seasonNumber}, but canonical media declares season ${input.canonicalMedia.season}`);
    const evidence: EpisodeResolutionEvidence[] = [membershipEvidence, ...canonicalSeasonConflicts.map((index, reasonIndex) => ({
      code: 'explicit_season_conflict' as const,
      reason: reasons[reasonIndex] ?? 'Canonical season identity conflicts',
      canonicalEpisodeId: input.candidateEpisodes[index]?.canonicalEpisodeId,
      targetIndex: index,
    }))];
    return rejectedResult(input, alignment, canonicalSeasonConflicts, evidence, reasons);
  }

  if (verified.rejectionReasons.length > 0) {
    const evidence: EpisodeResolutionEvidence[] = [membershipEvidence, ...verified.rejectionReasons.map((reason) => ({
      code: 'verified_mapping_conflict' as const,
      reason,
    }))];
    return rejectedResult(input, alignment, [], evidence, verified.rejectionReasons);
  }

  const mapping = alignment.mappings[sourceIndex];
  if (!mapping) {
    const reason = 'The aligner produced no mapping for the current source episode';
    return rejectedResult(input, alignment, [], [membershipEvidence, {
      code: 'verified_mapping_conflict',
      reason,
      sourceIndex,
    }], [reason]);
  }

  const mappedEvidence = alignmentEvidence(mapping.evidence, input.candidateEpisodes);
  const scopedEvidence: EpisodeResolutionEvidence = {
    code: 'canonical_media_match',
    reason: `All candidate episodes belong to canonical media ${input.canonicalMedia.mediaId}`,
  };
  const evidence = [membershipEvidence, scopedEvidence, ...mappedEvidence];
  const verifiedCurrent = verified.anchors.some((anchor) => anchor.sourceIndex === sourceIndex);

  if (mapping.state === 'conflicting' || alignment.state === 'conflicting') {
    const reasons = mapping.evidence
      .filter((item) => item.code === 'anchor_conflict')
      .map((item) => item.reason);
    if (reasons.length === 0) reasons.push('Episode evidence conflicts with reliable sequence order');
    return rejectedResult(input, alignment, mapping.alternatives, evidence, reasons);
  }

  if (verifiedCurrent) {
    const verifiedEvidence: EpisodeResolutionEvidence[] = [
      ...evidence,
      ...mapping.targetIndices.map((targetIndex) => ({
        code: 'verified_mapping' as const,
        reason: 'The source identity and canonical episode ID were both validated before using this mapping',
        canonicalEpisodeId: input.candidateEpisodes[targetIndex]?.canonicalEpisodeId,
        sourceIndex,
        targetIndex,
      })),
    ];
    return mappedResult(input, alignment, mapping.targetIndices, 'verified', verifiedEvidence);
  }

  if (
    input.canonicalMedia.season !== null &&
    input.sourceEpisode.parsedEpisodeInfo.seasonNumber !== null &&
    input.canonicalMedia.season !== input.sourceEpisode.parsedEpisodeInfo.seasonNumber
  ) {
    const reason = `Source episode declares season ${input.sourceEpisode.parsedEpisodeInfo.seasonNumber}, but canonical media declares season ${input.canonicalMedia.season}`;
    return rejectedResult(input, alignment, [], [...evidence, {
      code: 'explicit_season_conflict',
      reason,
      sourceIndex,
    }], [reason]);
  }

  const seasonConflicts = explicitSeasonConflict(
    input.sourceEpisode.parsedEpisodeInfo,
    input.candidateEpisodes,
  );
  if (mapping.state === 'unmatched' && seasonConflicts.length > 0) {
    const reasons = seasonConflicts.map((index) => {
      const candidate = input.candidateEpisodes[index];
      return `Episode number agrees with ${candidate?.canonicalEpisodeId ?? index}, but explicit seasons ${input.sourceEpisode.parsedEpisodeInfo.seasonNumber} and ${candidate?.seasonNumber} conflict`;
    });
    const conflictEvidence: EpisodeResolutionEvidence[] = [...evidence, ...seasonConflicts.map((index, reasonIndex) => ({
      code: 'explicit_season_conflict' as const,
      reason: reasons[reasonIndex] ?? 'Explicit episode seasons conflict',
      canonicalEpisodeId: input.candidateEpisodes[index]?.canonicalEpisodeId,
      sourceIndex,
      targetIndex: index,
    }))];
    return rejectedResult(input, alignment, seasonConflicts, conflictEvidence, reasons);
  }

  if (mapping.state === 'confirmed' || mapping.state === 'supported') {
    return mappedResult(input, alignment, mapping.targetIndices, 'supported', evidence);
  }

  if (mapping.state === 'unmatched') {
    return {
      state: 'not_found',
      sourceEpisode: input.sourceEpisode,
      selectedEpisode: null,
      candidates: [],
      evidence,
      rejectionReasons: [],
      alignment,
      reason: 'The source episode has a reliable identity that is absent from the canonical candidates',
    };
  }

  return {
    state: 'uncertain',
    sourceEpisode: input.sourceEpisode,
    selectedEpisode: null,
    candidates: candidateResults(
      input.candidateEpisodes,
      mapping.targetIndices,
      'uncertain',
      evidence,
    ),
    evidence,
    rejectionReasons: [],
    alignment,
    reason: mapping.targetIndices.length > 0
      ? 'Available evidence leaves multiple or title-only canonical candidates'
      : 'The source episode has insufficient identity evidence',
  };
}

export class EpisodeResolver {
  resolve(input: EpisodeResolutionInput): EpisodeResolution {
    return resolveEpisode(input);
  }
}
