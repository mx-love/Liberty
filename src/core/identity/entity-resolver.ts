import type {
  EvidenceField,
  IdentityPolicy,
  IdentityResolution,
  MediaIdentityInput,
} from '../types/identity.js';
import { collectCandidateEvidence } from './candidate-evidence.js';
import { DEFAULT_IDENTITY_POLICY, findIdentityBlockers } from './identity-policy.js';

export function resolveEntityIdentity(
  left: MediaIdentityInput,
  right: MediaIdentityInput,
  policy: IdentityPolicy = DEFAULT_IDENTITY_POLICY,
): IdentityResolution {
  const evidence = collectCandidateEvidence(left, right);
  const blockers = findIdentityBlockers(left, right, evidence, policy);
  const matchedFields = [...new Set(
    evidence
      .filter((item) => item.state === 'confirmed' || item.state === 'supporting')
      .map((item) => item.field),
  )] as EvidenceField[];

  if (blockers.length > 0) {
    return {
      decision: 'rejected',
      evidence,
      blockers,
      matchedFields,
      reason: `Rejected by ${blockers.map((blocker) => blocker.code).join(', ')}`,
    };
  }

  const hasConfirmedIdentity = evidence.some(
    (item) => item.field === 'externalId' && item.state === 'confirmed',
  );
  if (hasConfirmedIdentity) {
    return {
      decision: 'confirmed',
      evidence,
      blockers,
      matchedFields,
      reason: 'A verified external identity is equal and no blocking conflict exists',
    };
  }

  const hasTitleSupport = evidence.some(
    (item) => (item.field === 'title' || item.field === 'alias') && item.state === 'supporting',
  );
  const supportingFields = new Set(
    evidence.filter((item) => item.state === 'supporting').map((item) => item.field),
  );
  const hasUnblockedConflict = evidence.some((item) => item.state === 'conflicting');

  if (
    hasTitleSupport &&
    !hasUnblockedConflict &&
    supportingFields.size >= policy.minimumSupportingFields
  ) {
    return {
      decision: 'supported',
      evidence,
      blockers,
      matchedFields,
      reason: 'Title evidence is supported by independent compatible metadata',
    };
  }

  return {
    decision: 'uncertain',
    evidence,
    blockers,
    matchedFields,
    reason: hasTitleSupport
      ? 'Title evidence lacks enough independent support'
      : 'Available metadata cannot establish the same work',
  };
}

export class EntityResolver {
  constructor(private readonly policy: IdentityPolicy = DEFAULT_IDENTITY_POLICY) {}

  resolve(left: MediaIdentityInput, right: MediaIdentityInput): IdentityResolution {
    return resolveEntityIdentity(left, right, this.policy);
  }
}
