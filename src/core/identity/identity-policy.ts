import type {
  CandidateEvidence,
  IdentityBlocker,
  IdentityPolicy,
  MediaIdentityInput,
} from '../types/identity.js';

export const DEFAULT_IDENTITY_POLICY: IdentityPolicy = Object.freeze({
  minimumSupportingFields: 2,
  rejectConfirmedTitleConflict: true,
  strictYear: true,
  strictMediaType: true,
  strictSeason: true,
});

function blockerFor(
  evidence: readonly CandidateEvidence[],
  index: number,
  code: IdentityBlocker['code'],
): IdentityBlocker {
  const item = evidence[index];
  if (!item) throw new RangeError(`Evidence index ${index} does not exist`);
  return {
    code,
    field: item.field,
    reason: item.reason,
    evidenceIndex: index,
  };
}

export function findIdentityBlockers(
  left: MediaIdentityInput,
  right: MediaIdentityInput,
  evidence: readonly CandidateEvidence[],
  policy: IdentityPolicy = DEFAULT_IDENTITY_POLICY,
): readonly IdentityBlocker[] {
  const blockers: IdentityBlocker[] = [];

  for (let index = 0; index < evidence.length; index += 1) {
    const item = evidence[index];
    if (!item || item.state !== 'conflicting') continue;

    if (item.field === 'knownRelation') {
      blockers.push(blockerFor(evidence, index, 'known_different_media'));
    } else if (item.field === 'externalId') {
      blockers.push(blockerFor(evidence, index, 'external_id_conflict'));
    } else if (item.field === 'year' && policy.strictYear) {
      blockers.push(blockerFor(evidence, index, 'release_year_conflict'));
    } else if (item.field === 'season' && policy.strictSeason) {
      blockers.push(blockerFor(evidence, index, 'season_conflict'));
    } else if (item.field === 'mediaType' && policy.strictMediaType) {
      blockers.push(blockerFor(evidence, index, 'media_type_conflict'));
    } else if (
      item.field === 'title' &&
      policy.rejectConfirmedTitleConflict &&
      left.titleAuthority === 'confirmed' &&
      right.titleAuthority === 'confirmed'
    ) {
      blockers.push(blockerFor(evidence, index, 'confirmed_title_conflict'));
    }
  }

  return blockers;
}
