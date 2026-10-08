import { parseEpisode } from '../episode/episode-parser.js';
import type { DanmuClient } from './danmu-client.js';
import {
  adaptDanmuMatchCandidate,
  adaptDanmuSearchAnime,
  DanmuCandidateResolver,
} from './danmu-candidate-resolver.js';
import { DanmuEpisodeResolver } from './danmu-episode-resolver.js';
import type {
  DanmakuBinding,
  DanmakuCandidateResolution,
  DanmakuEpisodeResolution,
  DanmakuMediaCandidate,
  DanmakuResolveInput,
  DanmakuServiceResult,
  DanmakuServiceState,
  DanmuClientError,
  DanmuEpisode,
} from './danmu-types.js';

export interface DanmuServiceDependencies {
  readonly client: DanmuClient;
  readonly candidateResolver?: DanmuCandidateResolver;
  readonly episodeResolver?: DanmuEpisodeResolver;
}

interface CandidateDiscoverySuccess {
  readonly ok: true;
  readonly candidates: readonly DanmakuMediaCandidate[];
}

interface CandidateDiscoveryFailure {
  readonly ok: false;
  readonly error: DanmuClientError;
}

type CandidateDiscoveryResult = CandidateDiscoverySuccess | CandidateDiscoveryFailure;

function emptyResult(
  state: DanmakuServiceState,
  reason: string,
  options: {
    readonly binding?: DanmakuBinding | null;
    readonly candidateResolution?: DanmakuCandidateResolution | null;
    readonly episodeResolution?: DanmakuEpisodeResolution | null;
    readonly error?: DanmuClientError | null;
    readonly videoDuration?: number | null;
  } = {},
): DanmakuServiceResult {
  return {
    state,
    binding: options.binding ?? null,
    comments: [],
    videoDuration: options.videoDuration ?? null,
    candidateResolution: options.candidateResolution ?? null,
    episodeResolution: options.episodeResolution ?? null,
    error: options.error ?? null,
    reason,
  };
}

function clientErrorState(error: DanmuClientError): DanmakuServiceState {
  switch (error.kind) {
    case 'rate-limited':
    case 'client-error':
    case 'server-error':
    case 'network-error':
    case 'timeout':
    case 'aborted':
    case 'invalid-response':
      return error.kind;
  }
}

function padEpisodeNumber(value: number): string {
  return String(value).padStart(2, '0');
}

function reliableMatchFileName(input: DanmakuResolveInput): string | null {
  const season = input.media.season;
  const episode = input.episode.episodeNumber;
  if (
    input.episode.contentType !== 'regular' ||
    (input.media.mediaType !== 'series' && input.media.mediaType !== 'anime')
  ) {
    return null;
  }
  if (season === null || episode === null || season <= 0 || episode <= 0) return null;
  if (input.episode.seasonNumber !== null && input.episode.seasonNumber !== season) return null;
  return `${input.media.canonicalTitle.trim()} S${padEpisodeNumber(season)}E${padEpisodeNumber(episode)}`;
}

function hasReliableEpisodeIdentity(input: DanmakuResolveInput): boolean {
  const episode = input.episode;
  if (episode.identityState !== 'confirmed' && episode.identityState !== 'supported') {
    return false;
  }
  if (
    episode.episodeNumber !== null ||
    episode.absoluteNumber !== null ||
    episode.airDate !== null
  ) {
    return true;
  }

  const parsed = parseEpisode(episode.episodeTitle ?? '', {
    mediaType: input.media.mediaType,
  });
  return parsed.confidence === 'high' && (
    parsed.numberKind !== 'none' ||
    parsed.contentType === 'movie'
  );
}

function mediaCanResolve(input: DanmakuResolveInput): boolean {
  return (
    input.media.canonicalTitle.trim() !== '' &&
    (input.media.identityState === 'confirmed' || input.media.identityState === 'supported')
  );
}

interface EpisodeInputIssue {
  readonly state: 'episode-uncertain' | 'episode-rejected';
  readonly reason: string;
}

interface ManualEpisodeSelectionSuccess {
  readonly ok: true;
  readonly resolution: DanmakuEpisodeResolution;
}

interface ManualEpisodeSelectionFailure {
  readonly ok: false;
  readonly reason: string;
}

type ManualEpisodeSelectionResult =
  | ManualEpisodeSelectionSuccess
  | ManualEpisodeSelectionFailure;

function episodeInputIssue(input: DanmakuResolveInput): EpisodeInputIssue | null {
  if (input.episode.mediaId !== input.media.mediaId) {
    return {
      state: 'episode-rejected',
      reason: 'The target episode belongs to another canonical media',
    };
  }
  const occurrences = input.mediaEpisodes.filter(
    (episode) => episode.canonicalEpisodeId === input.episode.canonicalEpisodeId,
  );
  if (occurrences.length !== 1) {
    return {
      state: 'episode-rejected',
      reason: 'The target episode must occur exactly once in the canonical sequence',
    };
  }
  if (input.sourceEpisode.mappingState !== 'mapped' || input.sourceEpisode.canonicalEpisodeId === null) {
    return input.sourceEpisode.mappingState === 'conflicting'
      ? {
          state: 'episode-rejected',
          reason: 'The source episode has a conflicting canonical mapping',
        }
      : {
          state: 'episode-uncertain',
          reason: 'The source episode has not been mapped to a canonical episode',
        };
  }
  if (input.sourceEpisode.canonicalEpisodeId !== input.episode.canonicalEpisodeId) {
    return {
      state: 'episode-rejected',
      reason: 'The source episode is mapped to a different canonical episode',
    };
  }
  if (
    input.media.season !== null &&
    input.episode.seasonNumber !== null &&
    input.media.season !== input.episode.seasonNumber
  ) {
    return {
      state: 'episode-rejected',
      reason: 'The canonical media and target episode have conflicting seasons',
    };
  }
  return null;
}

function manualEpisodeInputIssue(input: DanmakuResolveInput): EpisodeInputIssue | null {
  if (input.manualEpisodeId === undefined) return null;
  if (input.manualCandidate === undefined) {
    return {
      state: 'episode-rejected',
      reason: 'A manual episode choice requires an explicitly selected danmu work',
    };
  }
  if (input.manualEpisodeId.trim() === '') {
    return {
      state: 'episode-rejected',
      reason: 'The manually selected danmu episodeId must not be empty',
    };
  }
  return null;
}

function applyManualEpisodeSelection(
  resolution: DanmakuEpisodeResolution,
  episodes: readonly DanmuEpisode[],
  manualEpisodeId: string,
): ManualEpisodeSelectionResult {
  if (resolution.state === 'rejected') {
    return {
      ok: false,
      reason: `The manual episode choice cannot override an identity conflict: ${resolution.reason}`,
    };
  }

  const episodeId = manualEpisodeId.trim();
  const upstreamMatches = episodes.filter((episode) => episode.episodeId === episodeId);
  if (upstreamMatches.length !== 1) {
    return {
      ok: false,
      reason: upstreamMatches.length === 0
        ? `The manually selected episodeId ${episodeId} is not present in the selected work`
        : `The manually selected episodeId ${episodeId} is not unique in the selected work`,
    };
  }

  const selected = upstreamMatches[0];
  if (selected === undefined) {
    return {
      ok: false,
      reason: `The manually selected episodeId ${episodeId} is not present in the selected work`,
    };
  }
  const compatibleMatches = resolution.candidates.filter((candidate) => candidate === selected);
  if (compatibleMatches.length !== 1) {
    return {
      ok: false,
      reason: `The manually selected episodeId ${episodeId} is not an identity-compatible candidate`,
    };
  }

  return {
    ok: true,
    resolution: {
      ...resolution,
      state: resolution.state === 'verified' ? 'verified' : 'supported',
      selected,
      reason: `The user confirmed identity-compatible danmu episode ${episodeId}`,
    },
  };
}

function candidateState(
  resolution: DanmakuCandidateResolution,
): DanmakuServiceState | null {
  switch (resolution.state) {
    case 'not_found': return 'candidate-not-found';
    case 'conflicting': return 'candidate-conflict';
    case 'uncertain': return 'candidate-uncertain';
    case 'supported':
    case 'verified':
      return null;
  }
}

function episodeState(
  resolution: DanmakuEpisodeResolution,
): DanmakuServiceState | null {
  switch (resolution.state) {
    case 'not_found': return 'episode-not-found';
    case 'uncertain': return 'episode-uncertain';
    case 'rejected': return 'episode-rejected';
    case 'supported':
    case 'verified':
      return null;
  }
}

/**
 * Coordinates the standalone Core V2 danmaku pipeline. It deliberately has no
 * dependency on player.js, ArtPlayer, UI state, or the legacy matcher.
 */
export class DanmuService {
  private readonly client: DanmuClient;
  private readonly candidateResolver: DanmuCandidateResolver;
  private readonly episodeResolver: DanmuEpisodeResolver;

  constructor(dependencies: DanmuServiceDependencies) {
    this.client = dependencies.client;
    this.candidateResolver = dependencies.candidateResolver ?? new DanmuCandidateResolver();
    this.episodeResolver = dependencies.episodeResolver ?? new DanmuEpisodeResolver();
  }

  async resolve(input: DanmakuResolveInput): Promise<DanmakuServiceResult> {
    const bindingResult = await this.resolveBinding(input);
    if (bindingResult.binding === null) return bindingResult;

    const comments = await this.client.getComments(bindingResult.binding.danmuEpisodeId, {
      signal: input.signal,
    });
    if (!comments.ok) {
      return emptyResult(clientErrorState(comments.error), comments.error.message, {
        binding: bindingResult.binding,
        candidateResolution: bindingResult.candidateResolution,
        episodeResolution: bindingResult.episodeResolution,
        error: comments.error,
      });
    }

    if (comments.data.comments.length === 0) {
      return emptyResult('comments-empty', 'The resolved danmu episode has no comments', {
        binding: bindingResult.binding,
        candidateResolution: bindingResult.candidateResolution,
        episodeResolution: bindingResult.episodeResolution,
        videoDuration: comments.data.videoDuration,
      });
    }

    return {
      state: 'success',
      binding: bindingResult.binding,
      comments: comments.data.comments,
      videoDuration: comments.data.videoDuration,
      candidateResolution: bindingResult.candidateResolution,
      episodeResolution: bindingResult.episodeResolution,
      error: null,
      reason: 'The canonical episode was bound and its comments were loaded',
    };
  }

  async resolveBinding(input: DanmakuResolveInput): Promise<DanmakuServiceResult> {
    if (!mediaCanResolve(input)) {
      return emptyResult('media-unresolved', 'Canonical media identity is not supported or confirmed');
    }

    const originalInputIssue = episodeInputIssue(input);
    if (originalInputIssue) return emptyResult(originalInputIssue.state, originalInputIssue.reason);
    const manualInputIssue = manualEpisodeInputIssue(input);
    if (manualInputIssue) return emptyResult(manualInputIssue.state, manualInputIssue.reason);
    const canonicalEpisode = input.mediaEpisodes.find(
      (episode) => episode.canonicalEpisodeId === input.episode.canonicalEpisodeId,
    );
    if (canonicalEpisode === undefined) {
      return emptyResult('episode-rejected', 'The canonical target episode is missing');
    }
    // The sequence member is the canonical source of truth. A caller-provided
    // duplicate object with the same ID cannot alter the query or episode facts.
    const canonicalInput: DanmakuResolveInput = { ...input, episode: canonicalEpisode };
    if (!hasReliableEpisodeIdentity(canonicalInput)) {
      return emptyResult('episode-uncertain', 'The target episode has no reliable content identity');
    }

    const discovery = await this.discoverCandidates(canonicalInput);
    if (!discovery.ok) {
      return emptyResult(clientErrorState(discovery.error), discovery.error.message, {
        error: discovery.error,
      });
    }

    const candidateResolution = this.candidateResolver.resolve(
      input.media,
      discovery.candidates,
      input.manualCandidate === undefined
        ? {}
        : { manualAnimeId: input.manualCandidate.animeId },
    );
    const unresolvedCandidateState = candidateState(candidateResolution);
    if (unresolvedCandidateState) {
      return emptyResult(unresolvedCandidateState, candidateResolution.reason, {
        candidateResolution,
      });
    }

    const selectedCandidate = candidateResolution.selected;
    if (selectedCandidate === null || candidateResolution.selectedBy === null) {
      return emptyResult('candidate-uncertain', 'Candidate resolution did not select one work', {
        candidateResolution,
      });
    }

    const bangumi = await this.client.getBangumi(selectedCandidate.animeId, {
      signal: canonicalInput.signal,
    });
    if (!bangumi.ok) {
      return emptyResult(clientErrorState(bangumi.error), bangumi.error.message, {
        candidateResolution,
        error: bangumi.error,
      });
    }
    if (bangumi.data.animeId !== selectedCandidate.animeId) {
      const error: DanmuClientError = {
        kind: 'invalid-response',
        status: bangumi.status,
        message: 'Bangumi response identity differs from the selected candidate',
      };
      return emptyResult('invalid-response', error.message, {
        candidateResolution,
        error,
      });
    }

    let episodeResolution = this.episodeResolver.resolve({
      media: canonicalInput.media,
      targetEpisode: canonicalInput.episode,
      canonicalEpisodes: canonicalInput.mediaEpisodes,
      danmuEpisodes: bangumi.data.episodes,
    });
    if (canonicalInput.manualEpisodeId !== undefined) {
      const manualSelection = applyManualEpisodeSelection(
        episodeResolution,
        bangumi.data.episodes,
        canonicalInput.manualEpisodeId,
      );
      if (!manualSelection.ok) {
        return emptyResult('episode-rejected', manualSelection.reason, {
          candidateResolution,
          episodeResolution,
        });
      }
      episodeResolution = manualSelection.resolution;
    }
    const unresolvedEpisodeState = episodeState(episodeResolution);
    if (unresolvedEpisodeState) {
      return emptyResult(unresolvedEpisodeState, episodeResolution.reason, {
        candidateResolution,
        episodeResolution,
      });
    }

    const selectedEpisode = episodeResolution.selected;
    if (selectedEpisode === null) {
      return emptyResult('episode-uncertain', 'Episode resolution did not select one episode', {
        candidateResolution,
        episodeResolution,
      });
    }

    const mappingState = candidateResolution.state === 'verified' && episodeResolution.state === 'verified'
      ? 'verified'
      : 'supported';
    const binding: DanmakuBinding = {
      canonicalMediaId: canonicalInput.media.mediaId,
      canonicalEpisodeId: canonicalInput.episode.canonicalEpisodeId,
      danmuAnimeId: selectedCandidate.animeId,
      danmuAnimeTitle: bangumi.data.animeTitle || selectedCandidate.animeTitle,
      danmuEpisodeId: selectedEpisode.episodeId,
      danmuEpisodeTitle: selectedEpisode.episodeTitle,
      mappingState,
      selectedBy: candidateResolution.selectedBy,
      scope: 'canonical_episode',
      evidence: [
        {
          stage: 'media',
          reason: candidateResolution.reason,
          identityEvidence: candidateResolution.evaluations.find(
            ({ candidate }) => candidate.animeId === selectedCandidate.animeId,
          )?.identity.evidence,
        },
        {
          stage: 'episode',
          reason: episodeResolution.reason,
          episodeEvidence: episodeResolution.evidence,
        },
        ...(candidateResolution.selectedBy === 'manual'
          ? [{
              stage: 'manual' as const,
              reason: canonicalInput.manualEpisodeId === undefined
                ? 'The user selected the work; the episode was resolved independently'
                : 'The user selected the work and confirmed one identity-compatible danmu episode',
            }]
          : []),
      ],
    };

    return emptyResult(
      mappingState === 'verified' ? 'binding-verified' : 'binding-supported',
      'A canonical-episode-scoped danmaku binding was established',
      { binding, candidateResolution, episodeResolution },
    );
  }

  private async discoverCandidates(input: DanmakuResolveInput): Promise<CandidateDiscoveryResult> {
    if (input.manualCandidate !== undefined) {
      return { ok: true, candidates: [input.manualCandidate] };
    }

    const matchFileName = reliableMatchFileName(input);
    if (matchFileName !== null) {
      const response = await this.client.match(matchFileName, { signal: input.signal });
      if (!response.ok) return { ok: false, error: response.error };
      return {
        ok: true,
        candidates: response.data.isMatched
          ? response.data.matches.map(adaptDanmuMatchCandidate)
          : [],
      };
    }

    const response = await this.client.searchAnime(input.media.canonicalTitle, {
      signal: input.signal,
    });
    if (!response.ok) return { ok: false, error: response.error };
    return { ok: true, candidates: response.data.animes.map(adaptDanmuSearchAnime) };
  }
}
