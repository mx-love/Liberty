var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/core/types/source.ts
var SourceError = class extends Error {
  constructor(code, message, options = {}) {
    super(message);
    __publicField(this, "code");
    __publicField(this, "sourceKey");
    __publicField(this, "status");
    __publicField(this, "retryable");
    __publicField(this, "cause");
    this.name = "SourceError";
    this.code = code;
    this.sourceKey = options.sourceKey ?? null;
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
    this.cause = options.cause;
  }
};

// src/core/identity/title-parser.ts
var CHINESE_DIGITS = {
  "\u96F6": 0,
  "\u3007": 0,
  "\u4E00": 1,
  "\u4E8C": 2,
  "\u4E24": 2,
  "\u4E09": 3,
  "\u56DB": 4,
  "\u4E94": 5,
  "\u516D": 6,
  "\u4E03": 7,
  "\u516B": 8,
  "\u4E5D": 9
};
var CHINESE_UNITS = {
  "\u5341": 10,
  "\u767E": 100,
  "\u5343": 1e3
};
var EDITION_PATTERN = /(?:未删减(?:版)?|完整(?:版)?|导演剪辑(?:版)?|加长(?:版)?|重制(?:版)?|修复(?:版)?|蓝光(?:版)?|(?:4K|8K)(?:版)?|杜比(?:版)?|国语(?:版)?|粤语(?:版)?|中字(?:版)?|双语(?:版)?)/giu;
var SEASON_TOKEN_PATTERN = "[\u3007\u96F6\u4E00\u4E8C\u4E24\u4E09\u56DB\u4E94\u516D\u4E03\u516B\u4E5D\u5341\u767E\\d]+";
function uniqueStrings(values) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
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
function parseChineseNumberToken(value) {
  const token = value.normalize("NFKC").trim();
  if (/^\d+$/.test(token)) {
    const number = Number(token);
    return Number.isSafeInteger(number) ? number : null;
  }
  if (!token || !/^[〇零一二两三四五六七八九十百千]+$/u.test(token)) {
    return null;
  }
  if (!/[十百千]/u.test(token)) {
    const digits = [...token].map((character) => CHINESE_DIGITS[character]);
    if (digits.some((digit) => digit === void 0)) return null;
    const number = Number(digits.join(""));
    return Number.isSafeInteger(number) ? number : null;
  }
  let total = 0;
  let currentDigit = 0;
  for (const character of token) {
    const digit = CHINESE_DIGITS[character];
    if (digit !== void 0) {
      currentDigit = digit;
      continue;
    }
    const unit = CHINESE_UNITS[character];
    if (unit === void 0) return null;
    total += (currentDigit || 1) * unit;
    currentDigit = 0;
  }
  return total + currentDigit;
}
function normalizeTitleForIdentity(value) {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/[\s\-_.·•:：,，/\\|()（）[\]【】《》"'“”‘’]+/gu, "");
}
function compactTitle(value) {
  return value.replace(/\s+/gu, " ").replace(/^[-–—:：|/\s]+|[-–—:：|/\s]+$/gu, "").trim();
}
function extractSeason(value) {
  const chinese = new RegExp(`\u7B2C\\s*(${SEASON_TOKEN_PATTERN})\\s*\u5B63`, "iu").exec(value);
  if (chinese) {
    const number = parseChineseNumberToken(chinese[1] ?? "");
    if (number !== null && number > 0) {
      return {
        value: number,
        source: "explicit_chinese_season",
        matched: chinese[0]
      };
    }
  }
  const english = /\bSeason\s*0*(\d{1,3})\b/iu.exec(value);
  if (english) {
    const number = Number(english[1]);
    if (number > 0) {
      return {
        value: number,
        source: "explicit_english_season",
        matched: english[0]
      };
    }
  }
  const shortCode = /S\s*0*(\d{1,3})(?![\dA-Z])/iu.exec(value);
  if (shortCode) {
    const number = Number(shortCode[1]);
    if (number > 0) {
      return {
        value: number,
        source: "explicit_s_code",
        matched: shortCode[0]
      };
    }
  }
  return null;
}
function extractYear(value) {
  const bracketed = /[（(\[【]\s*((?:19|20)\d{2})\s*[）)\]】]/u.exec(value);
  if (bracketed) {
    return {
      value: Number(bracketed[1]),
      source: "explicit_year",
      matched: bracketed[0]
    };
  }
  const separatedSuffix = /\s+((?:19|20)\d{2})\s*$/u.exec(value);
  if (separatedSuffix) {
    return {
      value: Number(separatedSuffix[1]),
      source: "explicit_year",
      matched: separatedSuffix[0]
    };
  }
  return null;
}
function stripEditionMarkers(value) {
  const markers = [];
  const title = value.replace(EDITION_PATTERN, (match) => {
    markers.push(match);
    return " ";
  });
  return { title, markers: uniqueStrings(markers) };
}
function splitTitleAndAliases(value) {
  return value.replace(/\s+又名\s*[:：]?\s*/gu, "|").split(/\s*[|｜]\s*|\s+[／/]\s+/gu).map((item) => item.trim()).filter(Boolean);
}
function parseTitle(rawTitle) {
  const raw = String(rawTitle ?? "");
  const normalizedRaw = raw.normalize("NFKC").trim();
  const titleParts = splitTitleAndAliases(normalizedRaw);
  const primary = titleParts[0] ?? normalizedRaw;
  const seasonToken = extractSeason(primary);
  const yearToken = extractYear(primary);
  let cleanedPrimary = primary;
  if (seasonToken) cleanedPrimary = cleanedPrimary.replace(seasonToken.matched, " ");
  if (yearToken) cleanedPrimary = cleanedPrimary.replace(yearToken.matched, " ");
  const primaryEdition = stripEditionMarkers(cleanedPrimary);
  const baseTitle = compactTitle(primaryEdition.title) || compactTitle(primary);
  const aliasResults = titleParts.slice(1).map((alias) => {
    const withoutSeason = extractSeason(alias);
    const withoutYear = extractYear(alias);
    let cleaned = alias;
    if (withoutSeason) cleaned = cleaned.replace(withoutSeason.matched, " ");
    if (withoutYear) cleaned = cleaned.replace(withoutYear.matched, " ");
    return stripEditionMarkers(cleaned);
  });
  const aliases = uniqueStrings(aliasResults.map((result) => compactTitle(result.title)));
  const editionMarkers = uniqueStrings([
    ...primaryEdition.markers,
    ...aliasResults.flatMap((result) => result.markers)
  ]);
  const uncertainTokens = [];
  const trailingNumber = /(?:^|[^\d])((?:\d{1,3}))\s*$/u.exec(baseTitle);
  if (!seasonToken && trailingNumber?.[1]) uncertainTokens.push(trailingNumber[1]);
  const partMarker = /(?:第\s*[〇零一二两三四五六七八九十百\d]+\s*部|\bPart\s*\d+\b)/iu.exec(baseTitle);
  if (!seasonToken && partMarker) uncertainTokens.push(partMarker[0]);
  const interpretations = [
    {
      baseTitle,
      season: seasonToken?.value ?? null,
      confidence: seasonToken ? "high" : "medium",
      source: seasonToken?.source ?? "literal_title"
    }
  ];
  if (!seasonToken && trailingNumber?.[1]) {
    const possibleSeason = Number(trailingNumber[1]);
    const stripped = compactTitle(baseTitle.slice(0, Math.max(0, baseTitle.length - trailingNumber[1].length)));
    if (stripped && possibleSeason > 0 && possibleSeason <= 99) {
      interpretations.push({
        baseTitle: stripped,
        season: possibleSeason,
        confidence: "low",
        source: "trailing_number"
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
    interpretations
  };
}
var TitleParser = class {
  parse(rawTitle) {
    return parseTitle(rawTitle);
  }
};

// src/core/identity/candidate-evidence.ts
function normalizeComparable(value) {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/[\s\-_.·•:：,，/\\|()（）[\]【】"'“”‘’]+/gu, "");
}
function normalizeValues(values) {
  return new Set((values ?? []).map(normalizeComparable).filter(Boolean));
}
function titleValues(input, title) {
  const result = /* @__PURE__ */ new Map();
  const primary = normalizeTitleForIdentity(title.baseTitle);
  if (primary) result.set(primary, "title");
  for (const alias of [...title.aliases, ...input.aliases ?? []]) {
    const normalized = normalizeTitleForIdentity(alias);
    if (normalized && !result.has(normalized)) result.set(normalized, "alias");
  }
  return result;
}
function prepare(input) {
  const title = input.parsedTitle ?? parseTitle(input.rawTitle);
  return {
    input,
    title,
    titleValues: titleValues(input, title),
    year: input.year !== void 0 ? input.year : title.year,
    season: input.season !== void 0 ? input.season : title.season
  };
}
function unknown(field, reason, left, right) {
  return { field, state: "unknown", reason, leftValue: left, rightValue: right };
}
function compareTitle(left, right) {
  for (const [value, leftKind] of left.titleValues) {
    const rightKind = right.titleValues.get(value);
    if (rightKind) {
      const field = leftKind === "alias" || rightKind === "alias" ? "alias" : "title";
      return {
        field,
        state: "supporting",
        reason: field === "title" ? "Normalized base titles are equal" : "A declared title or alias is shared",
        leftValue: left.title.baseTitle,
        rightValue: right.title.baseTitle
      };
    }
  }
  if (!left.title.normalizedBaseTitle || !right.title.normalizedBaseTitle) {
    return unknown("title", "At least one title is empty after normalization", left.title.rawTitle, right.title.rawTitle);
  }
  return {
    field: "title",
    state: "conflicting",
    reason: "No normalized base title or declared alias is shared",
    leftValue: left.title.baseTitle,
    rightValue: right.title.baseTitle
  };
}
function compareOptionalNumber(field, left, right) {
  if (left === null || right === null) {
    return unknown(field, `${field} is unknown on at least one side`, left, right);
  }
  if (left === right) {
    return {
      field,
      state: "supporting",
      reason: `${field} values are equal`,
      leftValue: left,
      rightValue: right
    };
  }
  if (field === "year" && Math.abs(left - right) === 1) {
    return unknown(
      field,
      "One-year differences can be broadcast, import, or edition metadata and are not decisive",
      left,
      right
    );
  }
  return {
    field,
    state: "conflicting",
    reason: `${field} values explicitly differ`,
    leftValue: left,
    rightValue: right
  };
}
function compareMediaType(left, right) {
  const leftType = left.input.mediaType ?? "unknown";
  const rightType = right.input.mediaType ?? "unknown";
  if (leftType === "unknown" || rightType === "unknown") {
    return unknown("mediaType", "Media type is unknown on at least one side", leftType, rightType);
  }
  return {
    field: "mediaType",
    state: leftType === rightType ? "supporting" : "conflicting",
    reason: leftType === rightType ? "Media types are equal" : "Known media types explicitly differ",
    leftValue: leftType,
    rightValue: rightType
  };
}
function comparePeople(field, leftValues, rightValues) {
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
      rightValues
    );
  }
  return {
    field,
    state: "supporting",
    reason: `${shared.length} normalized ${field} value(s) are shared`,
    leftValue: leftValues,
    rightValue: rightValues
  };
}
function compareDescriptiveList(field, leftValues, rightValues) {
  const left = normalizeValues(leftValues);
  const right = normalizeValues(rightValues);
  if (left.size === 0 || right.size === 0) {
    return unknown(field, `${field} metadata is missing on at least one side`, leftValues ?? [], rightValues ?? []);
  }
  const shared = [...left].filter((value) => right.has(value));
  return shared.length > 0 ? {
    field,
    state: "supporting",
    reason: `A normalized ${field} value is shared`,
    leftValue: leftValues,
    rightValue: rightValues
  } : unknown(
    field,
    `${field} labels differ but are not authoritative identity blockers`,
    leftValues,
    rightValues
  );
}
function compareExternalIds(left, right) {
  const leftIds = left.input.externalIds ?? {};
  const rightIds = right.input.externalIds ?? {};
  const sharedProviders = Object.keys(leftIds).filter((provider) => rightIds[provider] !== void 0);
  if (sharedProviders.length === 0) {
    return [unknown("externalId", "No external ID namespace is shared", leftIds, rightIds)];
  }
  return sharedProviders.map((provider) => {
    const leftValue = String(leftIds[provider] ?? "").trim();
    const rightValue = String(rightIds[provider] ?? "").trim();
    const equal = leftValue !== "" && leftValue === rightValue;
    return {
      field: "externalId",
      state: equal ? "confirmed" : "conflicting",
      reason: equal ? `Verified ${provider} IDs are equal` : `Verified ${provider} IDs explicitly differ`,
      leftValue,
      rightValue,
      source: provider
    };
  });
}
function compareKnownRelation(left, right) {
  const leftRejectsRight = right.input.recordId !== void 0 && left.input.knownDifferentFrom?.includes(right.input.recordId);
  const rightRejectsLeft = left.input.recordId !== void 0 && right.input.knownDifferentFrom?.includes(left.input.recordId);
  if (leftRejectsRight || rightRejectsLeft) {
    return {
      field: "knownRelation",
      state: "conflicting",
      reason: "A verified relation marks these records as different works",
      leftValue: left.input.recordId ?? null,
      rightValue: right.input.recordId ?? null
    };
  }
  return unknown(
    "knownRelation",
    "No verified same/different relation is available",
    left.input.recordId ?? null,
    right.input.recordId ?? null
  );
}
function collectCandidateEvidence(leftInput, rightInput) {
  const left = prepare(leftInput);
  const right = prepare(rightInput);
  return [
    compareKnownRelation(left, right),
    ...compareExternalIds(left, right),
    compareTitle(left, right),
    compareOptionalNumber("year", left.year, right.year),
    compareOptionalNumber("season", left.season, right.season),
    compareMediaType(left, right),
    comparePeople("director", left.input.directors, right.input.directors),
    comparePeople("actors", left.input.actors, right.input.actors),
    compareDescriptiveList("area", left.input.areas, right.input.areas),
    compareDescriptiveList("language", left.input.languages, right.input.languages)
  ];
}
var CandidateEvidenceCollector = class {
  collect(left, right) {
    return collectCandidateEvidence(left, right);
  }
};

// src/core/identity/identity-policy.ts
var DEFAULT_IDENTITY_POLICY = Object.freeze({
  minimumSupportingFields: 2,
  rejectConfirmedTitleConflict: true,
  strictYear: true,
  strictMediaType: true,
  strictSeason: true
});
function blockerFor(evidence, index, code) {
  const item = evidence[index];
  if (!item) throw new RangeError(`Evidence index ${index} does not exist`);
  return {
    code,
    field: item.field,
    reason: item.reason,
    evidenceIndex: index
  };
}
function findIdentityBlockers(left, right, evidence, policy = DEFAULT_IDENTITY_POLICY) {
  const blockers = [];
  for (let index = 0; index < evidence.length; index += 1) {
    const item = evidence[index];
    if (!item || item.state !== "conflicting") continue;
    if (item.field === "knownRelation") {
      blockers.push(blockerFor(evidence, index, "known_different_media"));
    } else if (item.field === "externalId") {
      blockers.push(blockerFor(evidence, index, "external_id_conflict"));
    } else if (item.field === "year" && policy.strictYear) {
      blockers.push(blockerFor(evidence, index, "release_year_conflict"));
    } else if (item.field === "season" && policy.strictSeason) {
      blockers.push(blockerFor(evidence, index, "season_conflict"));
    } else if (item.field === "mediaType" && policy.strictMediaType) {
      blockers.push(blockerFor(evidence, index, "media_type_conflict"));
    } else if (item.field === "title" && policy.rejectConfirmedTitleConflict && left.titleAuthority === "confirmed" && right.titleAuthority === "confirmed") {
      blockers.push(blockerFor(evidence, index, "confirmed_title_conflict"));
    }
  }
  return blockers;
}

// src/core/identity/entity-resolver.ts
function resolveEntityIdentity(left, right, policy = DEFAULT_IDENTITY_POLICY) {
  const evidence = collectCandidateEvidence(left, right);
  const blockers = findIdentityBlockers(left, right, evidence, policy);
  const matchedFields = [...new Set(
    evidence.filter((item) => item.state === "confirmed" || item.state === "supporting").map((item) => item.field)
  )];
  if (blockers.length > 0) {
    return {
      decision: "rejected",
      evidence,
      blockers,
      matchedFields,
      reason: `Rejected by ${blockers.map((blocker) => blocker.code).join(", ")}`
    };
  }
  const hasConfirmedIdentity = evidence.some(
    (item) => item.field === "externalId" && item.state === "confirmed"
  );
  if (hasConfirmedIdentity) {
    return {
      decision: "confirmed",
      evidence,
      blockers,
      matchedFields,
      reason: "A verified external identity is equal and no blocking conflict exists"
    };
  }
  const hasTitleSupport = evidence.some(
    (item) => (item.field === "title" || item.field === "alias") && item.state === "supporting"
  );
  const supportingFields = new Set(
    evidence.filter((item) => item.state === "supporting").map((item) => item.field)
  );
  const hasUnblockedConflict = evidence.some((item) => item.state === "conflicting");
  if (hasTitleSupport && !hasUnblockedConflict && supportingFields.size >= policy.minimumSupportingFields) {
    return {
      decision: "supported",
      evidence,
      blockers,
      matchedFields,
      reason: "Title evidence is supported by independent compatible metadata"
    };
  }
  return {
    decision: "uncertain",
    evidence,
    blockers,
    matchedFields,
    reason: hasTitleSupport ? "Title evidence lacks enough independent support" : "Available metadata cannot establish the same work"
  };
}
var EntityResolver = class {
  constructor(policy = DEFAULT_IDENTITY_POLICY) {
    __publicField(this, "policy", policy);
  }
  resolve(left, right) {
    return resolveEntityIdentity(left, right, this.policy);
  }
};

// src/core/episode/episode-parser.ts
var NUMBER_TOKEN = "[\u3007\u96F6\u4E00\u4E8C\u4E24\u4E09\u56DB\u4E94\u516D\u4E03\u516B\u4E5D\u5341\u767E\u5343\\d]+";
var TECHNICAL_TOKEN_PATTERN = /(?:1080p|720p|2160p|4k|8k|h\.?264|h\.?265|hevc|av1|10bit|hdr|dolby|aac|国语|粤语|中字|双语|bd|bluray|web-?dl|webrip|线路\s*\d+|备用|高清|超清)/giu;
function validPositiveEpisodeNumber(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= 1e5;
}
function toNumber(token) {
  const value = parseChineseNumberToken(token);
  return value !== null && validPositiveEpisodeNumber(value) ? value : null;
}
function asIsoDate(year, month, day) {
  if (year < 1900 || year > 2099 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function extractBroadcastDate(value) {
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
function extractPart(value) {
  const upper = /(?:上篇|上部|上集|上期)(?:版)?/u.exec(value);
  if (upper) return { part: "upper", matched: upper[0] };
  const lower = /(?:下篇|下部|下集|下期)(?:版)?/u.exec(value);
  if (lower) return { part: "lower", matched: lower[0] };
  const english = /\bPart\s*0*(\d{1,3})\b/iu.exec(value);
  if (english) return { part: Number(english[1]), matched: english[0] };
  return null;
}
function extractContentMarker(value) {
  const preview = /(?:预告(?:片)?|先导片|先行片|\btrailer\b|\bPV\s*\d*\b)/iu.exec(value);
  if (preview) {
    return {
      contentType: "preview",
      specialKind: null,
      specialNumber: null,
      matched: preview[0],
      evidenceCode: "preview_marker"
    };
  }
  const recap = /(?:总集篇|总集编|回顾|\brecap\b)/iu.exec(value);
  if (recap) {
    return {
      contentType: "recap",
      specialKind: null,
      specialNumber: null,
      matched: recap[0],
      evidenceCode: "recap_marker"
    };
  }
  const interview = /(?:采访|访谈|\binterview\b)/iu.exec(value);
  if (interview) {
    return {
      contentType: "interview",
      specialKind: null,
      specialNumber: null,
      matched: interview[0],
      evidenceCode: "interview_marker"
    };
  }
  const codedSpecial = /\b(SP|OVA|OAD)\s*0*(\d{1,4})?\b/iu.exec(value);
  if (codedSpecial) {
    const kind = (codedSpecial[1] ?? "").toLocaleLowerCase("en-US");
    const specialNumber = codedSpecial[2] ? Number(codedSpecial[2]) : null;
    return {
      contentType: "special",
      specialKind: kind,
      specialNumber,
      matched: codedSpecial[0],
      evidenceCode: "special_marker"
    };
  }
  const extra = /(?:番外|加更(?:版)?|花絮|彩蛋|特别节目)/u.exec(value);
  if (extra) {
    return {
      contentType: "special",
      specialKind: "extra",
      specialNumber: null,
      matched: extra[0],
      evidenceCode: "special_marker"
    };
  }
  const special = /(?:特别篇|特别编|特别版)/u.exec(value);
  if (special) {
    return {
      contentType: "special",
      specialKind: "special",
      specialNumber: null,
      matched: special[0],
      evidenceCode: "special_marker"
    };
  }
  const movie = /(?:正片|剧场版|電影版|电影版)/u.exec(value);
  if (movie) {
    return {
      contentType: "movie",
      specialKind: null,
      specialNumber: null,
      matched: movie[0],
      evidenceCode: "movie_marker"
    };
  }
  return null;
}
function extractNumericIdentity(value) {
  const seasonEpisode = /S\s*0*(\d{1,3})\s*E(?:P)?\s*0*(\d{1,5})(?!\d)/iu.exec(value);
  if (seasonEpisode) {
    const season = Number(seasonEpisode[1]);
    const episode = Number(seasonEpisode[2]);
    if (season > 0 && validPositiveEpisodeNumber(episode)) {
      return {
        number: episode,
        kind: "episode",
        season,
        matched: seasonEpisode[0],
        confidence: "high",
        evidenceCode: "explicit_season_episode"
      };
    }
  }
  const explicitEpisode = new RegExp(`\u7B2C\\s*(${NUMBER_TOKEN})\\s*(\u96C6|\u8BDD)`, "iu").exec(value);
  if (explicitEpisode) {
    const number = toNumber(explicitEpisode[1] ?? "");
    if (number !== null) {
      return {
        number,
        kind: "episode",
        season: null,
        matched: explicitEpisode[0],
        confidence: "high",
        evidenceCode: "explicit_episode_label"
      };
    }
  }
  const explicitIssue = new RegExp(`\u7B2C\\s*(${NUMBER_TOKEN})\\s*\u671F`, "iu").exec(value);
  if (explicitIssue) {
    const number = toNumber(explicitIssue[1] ?? "");
    if (number !== null) {
      return {
        number,
        kind: "issue",
        season: null,
        matched: explicitIssue[0],
        confidence: "high",
        evidenceCode: "explicit_issue_label"
      };
    }
  }
  const shortEpisode = /(?:^|[^A-Z\d])(?:EP|E)\s*0*(\d{1,5})(?![A-Z\d])/iu.exec(value);
  if (shortEpisode) {
    const number = Number(shortEpisode[1]);
    if (validPositiveEpisodeNumber(number)) {
      return {
        number,
        kind: "episode",
        season: null,
        matched: shortEpisode[0].trim(),
        confidence: "high",
        evidenceCode: "short_episode_label"
      };
    }
  }
  const suffixEpisode = /(?:^|[^\d])(\d{1,5})\s*(集|话)(?![集话])/u.exec(value);
  if (suffixEpisode) {
    const number = Number(suffixEpisode[1]);
    if (validPositiveEpisodeNumber(number)) {
      return {
        number,
        kind: "episode",
        season: null,
        matched: suffixEpisode[0].trim(),
        confidence: "high",
        evidenceCode: "explicit_episode_label"
      };
    }
  }
  const pureNumeric = /^0*(\d{1,8})$/u.exec(value.trim());
  if (pureNumeric) {
    const number = Number(pureNumeric[1]);
    if (validPositiveEpisodeNumber(number) && !(number >= 1900 && number <= 2099)) {
      return {
        number,
        kind: "episode",
        season: null,
        matched: pureNumeric[0],
        confidence: "medium",
        evidenceCode: "pure_numeric_label"
      };
    }
  }
  return null;
}
function episodeTitle(value, consumed) {
  let title = value;
  for (const token of consumed.filter(Boolean)) title = title.replace(token, " ");
  title = title.replace(TECHNICAL_TOKEN_PATTERN, " ").replace(/[-–—_|/]+/gu, " ").replace(/\s+/gu, " ").trim();
  return title.length >= 2 ? title : null;
}
function technicalOnly(value) {
  const remaining = value.replace(TECHNICAL_TOKEN_PATTERN, " ").replace(/[\s._\-()[\]（）【】]+/gu, "");
  return value.trim() !== "" && remaining === "";
}
function parseEpisode(rawName, options = {}) {
  const raw = String(rawName ?? "");
  const value = raw.normalize("NFKC").trim();
  const evidence = [];
  const uncertainTokens = [];
  const date = extractBroadcastDate(value);
  const part = extractPart(value);
  const marker = extractContentMarker(value);
  const numeric = date ? null : extractNumericIdentity(value);
  if (date) {
    evidence.push({
      code: "broadcast_date",
      token: date.matched,
      reason: "A valid calendar date identifies this item and is not an episode number"
    });
  }
  if (part) {
    evidence.push({ code: "part_marker", token: part.matched, reason: "An explicit part marker was found" });
  }
  if (marker) {
    evidence.push({
      code: marker.evidenceCode,
      token: marker.matched,
      reason: `The item is explicitly marked as ${marker.contentType}`
    });
  }
  if (numeric) {
    evidence.push({
      code: numeric.evidenceCode,
      token: numeric.matched,
      reason: `Parsed an explicit ${numeric.kind} identity`
    });
  }
  const isTechnicalOnly = technicalOnly(value);
  if (isTechnicalOnly) {
    evidence.push({
      code: "ignored_technical_token",
      token: value,
      reason: "Resolution, codec, language, or route labels cannot be episode numbers"
    });
  }
  let contentType = marker?.contentType ?? "unknown";
  if (!marker && numeric) contentType = "regular";
  if (!marker && date) contentType = "regular";
  if (!marker && isTechnicalOnly && options.mediaType === "movie") contentType = "movie";
  const nonRegularMarker = marker !== null && marker.contentType !== "regular";
  const episodeNumber = nonRegularMarker || date ? null : numeric?.number ?? null;
  const numberKind = date ? "date" : marker?.contentType === "special" ? "special" : episodeNumber !== null ? numeric?.kind ?? "episode" : "none";
  const consumed = [date?.matched ?? "", marker?.matched ?? "", numeric?.matched ?? "", part?.matched ?? ""];
  if (nonRegularMarker && numeric) {
    uncertainTokens.push(numeric.matched);
  }
  if (part && !numeric && !date) {
    uncertainTokens.push(part.matched);
  }
  let confidence = "none";
  if (date || marker || numeric?.confidence === "high") confidence = "high";
  else if (numeric) confidence = numeric.confidence;
  else if (part || isTechnicalOnly) confidence = "low";
  if (evidence.length === 0) {
    evidence.push({ code: "unrecognized", token: value, reason: "No reliable episode identity was found" });
  }
  return {
    rawName: raw,
    contentType,
    seasonNumber: numeric?.season ?? null,
    episodeNumber,
    absoluteNumber: numeric?.kind === "episode" && numeric.season === null ? numeric.number : null,
    specialNumber: marker?.specialNumber ?? null,
    specialKind: marker?.specialKind ?? null,
    airDate: date?.airDate ?? null,
    episodeTitle: episodeTitle(value, consumed),
    part: part?.part ?? null,
    numberKind,
    confidence,
    ambiguous: numeric?.evidenceCode === "pure_numeric_label" || nonRegularMarker && numeric !== null || part !== null && numeric === null && date === null || marker?.contentType === "special" && marker.specialNumber === null,
    evidence,
    uncertainTokens
  };
}
var EpisodeParser = class {
  parse(rawName, options = {}) {
    return parseEpisode(rawName, options);
  }
};

// src/core/episode/episode-aligner.ts
function parseSequence(sequence) {
  return sequence.map((entry) => typeof entry === "string" ? parseEpisode(entry) : entry);
}
function normalizedEpisodeTitle(episode) {
  return episode.episodeTitle ? normalizeTitleForIdentity(episode.episodeTitle) : "";
}
function compatibleContentType(left, right) {
  return left.contentType === "unknown" || right.contentType === "unknown" || left.contentType === right.contentType;
}
function compatibleSeason(left, right) {
  return left.seasonNumber === null || right.seasonNumber === null || left.seasonNumber === right.seasonNumber;
}
function matchCandidate(source, target, targetIndex) {
  if (!compatibleContentType(source, target)) return null;
  if (source.airDate !== null && target.airDate !== null && source.airDate === target.airDate) {
    return {
      targetIndex,
      rank: 3,
      mappingState: "confirmed",
      evidence: [{
        code: "exact_air_date",
        reason: `Both entries identify broadcast date ${source.airDate}`,
        targetIndex
      }]
    };
  }
  if (source.absoluteNumber !== null && target.absoluteNumber !== null && source.absoluteNumber === target.absoluteNumber && compatibleSeason(source, target)) {
    return {
      targetIndex,
      rank: 3,
      mappingState: "confirmed",
      evidence: [{
        code: "exact_absolute_number",
        reason: `Both entries identify absolute episode ${source.absoluteNumber}`,
        targetIndex
      }]
    };
  }
  if (source.episodeNumber !== null && target.episodeNumber !== null && source.episodeNumber === target.episodeNumber && source.numberKind === target.numberKind && compatibleSeason(source, target)) {
    const isIssue = source.numberKind === "issue";
    const seasonDescription = source.seasonNumber !== null && target.seasonNumber !== null ? ` in season ${source.seasonNumber}` : "";
    return {
      targetIndex,
      rank: 3,
      mappingState: "confirmed",
      evidence: [{
        code: isIssue ? "exact_issue_number" : "exact_episode_number",
        reason: `Both entries identify ${isIssue ? "issue" : "episode"} ${source.episodeNumber}${seasonDescription}`,
        targetIndex
      }]
    };
  }
  if (source.contentType === "special" && target.contentType === "special" && source.specialKind !== null && source.specialKind === target.specialKind && source.specialNumber !== null && source.specialNumber === target.specialNumber) {
    return {
      targetIndex,
      rank: 3,
      mappingState: "confirmed",
      evidence: [{
        code: "exact_special_identity",
        reason: `Both entries identify ${source.specialKind.toUpperCase()} ${source.specialNumber}`,
        targetIndex
      }]
    };
  }
  const sourceTitle = normalizedEpisodeTitle(source);
  const targetTitle = normalizedEpisodeTitle(target);
  if (sourceTitle && sourceTitle === targetTitle) {
    const samePart = source.part !== null && source.part === target.part;
    return {
      targetIndex,
      rank: samePart ? 2 : 1,
      mappingState: samePart ? "supported" : "uncertain",
      evidence: [{
        code: "exact_content_title",
        reason: samePart ? "Episode titles and explicit part markers are equal" : "Episode titles are equal, but title evidence alone cannot confirm an episode",
        targetIndex
      }]
    };
  }
  return null;
}
function hasReliableIdentity(episode) {
  return episode.airDate !== null || episode.episodeNumber !== null || episode.contentType === "special" && episode.specialKind !== null && episode.specialNumber !== null;
}
function canInferBetweenAnchors(episode) {
  return !hasReliableIdentity(episode) && episode.contentType === "unknown" && episode.numberKind === "none" && episode.part === null;
}
function unresolvedMapping(sourceIndex, source, candidates) {
  if (candidates.length === 0) {
    const reliable = hasReliableIdentity(source);
    return {
      sourceIndex,
      targetIndices: [],
      state: reliable ? "unmatched" : "uncertain",
      evidence: [{
        code: "no_reliable_identity",
        reason: reliable ? "The source has a reliable identity, but the target sequence has no compatible entry" : "The source entry has no reliable episode identity",
        sourceIndex
      }],
      alternatives: []
    };
  }
  const alternatives = candidates.map((candidate) => candidate.targetIndex);
  return {
    sourceIndex,
    targetIndices: alternatives,
    state: "uncertain",
    evidence: [{
      code: "ambiguous_candidates",
      reason: candidates.length === 1 ? "Only episode-title evidence is available; title equality alone is not decisive" : `${candidates.length} target entries share the best available identity evidence`,
      sourceIndex
    }, ...candidates.flatMap((candidate) => candidate.evidence)],
    alternatives
  };
}
function automaticMapping(sourceIndex, source, targets) {
  const candidates = targets.map((target, targetIndex) => matchCandidate(source, target, targetIndex)).filter((candidate) => candidate !== null);
  const highestRank = candidates.reduce((rank, candidate) => Math.max(rank, candidate.rank), 0);
  const best = candidates.filter((candidate) => candidate.rank === highestRank);
  if (best.length !== 1) return unresolvedMapping(sourceIndex, source, best);
  const selected = best[0];
  if (!selected || selected.mappingState === "uncertain") {
    return unresolvedMapping(sourceIndex, source, best);
  }
  return {
    sourceIndex,
    targetIndices: [selected.targetIndex],
    state: selected.mappingState,
    evidence: selected.evidence.map((evidence) => ({ ...evidence, sourceIndex })),
    alternatives: []
  };
}
function normalizedAnchorTargets(anchor) {
  return [...new Set(anchor.targetIndices)].sort((left, right) => left - right);
}
function sameIndices(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
function manualMappings(sourceLength, targetLength, anchors) {
  const mappings = /* @__PURE__ */ new Map();
  const evidence = [];
  for (const anchor of anchors) {
    const targetIndices = normalizedAnchorTargets(anchor);
    const inBounds = anchor.sourceIndex >= 0 && anchor.sourceIndex < sourceLength && targetIndices.length > 0 && targetIndices.every((index) => index >= 0 && index < targetLength);
    if (!inBounds) {
      evidence.push({
        code: "anchor_conflict",
        reason: `Manual anchor ${anchor.sourceIndex} -> [${targetIndices.join(", ")}] is out of bounds`,
        sourceIndex: anchor.sourceIndex
      });
      continue;
    }
    const existing = mappings.get(anchor.sourceIndex);
    if (existing && !sameIndices(existing.targetIndices, targetIndices)) {
      const conflict = {
        sourceIndex: anchor.sourceIndex,
        targetIndices: [],
        state: "conflicting",
        evidence: [{
          code: "anchor_conflict",
          reason: `Manual anchors assign source ${anchor.sourceIndex} to different targets`,
          sourceIndex: anchor.sourceIndex
        }],
        alternatives: [.../* @__PURE__ */ new Set([...existing.targetIndices, ...targetIndices])]
      };
      mappings.set(anchor.sourceIndex, conflict);
      evidence.push(...conflict.evidence);
      continue;
    }
    if (!existing) {
      mappings.set(anchor.sourceIndex, {
        sourceIndex: anchor.sourceIndex,
        targetIndices,
        state: "confirmed",
        evidence: [{
          code: "manual_anchor",
          reason: anchor.evidence?.trim() || "A caller-provided manual anchor confirms this mapping",
          sourceIndex: anchor.sourceIndex,
          targetIndex: targetIndices.length === 1 ? targetIndices[0] : void 0
        }],
        alternatives: []
      });
    }
  }
  return { mappings, evidence };
}
function markOrderConflicts(mappings, sources, targets) {
  const conflicts = /* @__PURE__ */ new Set();
  const anchors = mappings.filter((mapping) => {
    const targetIndex = mapping.targetIndices[0];
    const source = sources[mapping.sourceIndex];
    const target = targetIndex === void 0 ? void 0 : targets[targetIndex];
    return mapping.state === "confirmed" && mapping.targetIndices.length === 1 && source?.contentType === "regular" && target?.contentType === "regular";
  }).map((mapping) => ({
    sourceIndex: mapping.sourceIndex,
    targetIndex: mapping.targetIndices[0]
  })).sort((left, right) => left.sourceIndex - right.sourceIndex);
  for (let index = 1; index < anchors.length; index += 1) {
    const previous = anchors[index - 1];
    const current = anchors[index];
    if (previous && current && current.targetIndex <= previous.targetIndex) {
      conflicts.add(previous.sourceIndex);
      conflicts.add(current.sourceIndex);
    }
  }
  if (conflicts.size === 0) return { mappings, evidence: [] };
  const evidence = [...conflicts].map((sourceIndex) => ({
    code: "anchor_conflict",
    reason: "Reliable episode anchors reverse or duplicate target sequence order",
    sourceIndex
  }));
  return {
    mappings: mappings.map((mapping) => conflicts.has(mapping.sourceIndex) ? {
      ...mapping,
      state: "conflicting",
      evidence: [...mapping.evidence, ...evidence.filter((item) => item.sourceIndex === mapping.sourceIndex)],
      alternatives: mapping.targetIndices,
      targetIndices: []
    } : mapping),
    evidence
  };
}
function inferBoundedMappings(mappings, sources, targets) {
  const result = [...mappings];
  const anchors = result.filter((mapping) => mapping.state === "confirmed" && mapping.targetIndices.length === 1).map((mapping) => ({
    sourceIndex: mapping.sourceIndex,
    targetIndex: mapping.targetIndices[0]
  })).sort((left, right) => left.sourceIndex - right.sourceIndex);
  const usedTargets = new Set(
    result.filter((mapping) => mapping.state === "confirmed" || mapping.state === "supported").flatMap((mapping) => mapping.targetIndices)
  );
  for (let anchorIndex = 1; anchorIndex < anchors.length; anchorIndex += 1) {
    const left = anchors[anchorIndex - 1];
    const right = anchors[anchorIndex];
    if (!left || !right || right.targetIndex <= left.targetIndex) continue;
    const sourceIndices = Array.from(
      { length: Math.max(0, right.sourceIndex - left.sourceIndex - 1) },
      (_, offset) => left.sourceIndex + offset + 1
    );
    const targetIndices = Array.from(
      { length: Math.max(0, right.targetIndex - left.targetIndex - 1) },
      (_, offset) => left.targetIndex + offset + 1
    ).filter((targetIndex) => !usedTargets.has(targetIndex));
    if (sourceIndices.length === 0 || sourceIndices.length !== targetIndices.length) continue;
    const inferable = sourceIndices.every((sourceIndex) => {
      const mapping = result[sourceIndex];
      const source = sources[sourceIndex];
      return mapping?.state === "uncertain" && source !== void 0 && canInferBetweenAnchors(source);
    }) && targetIndices.every((targetIndex) => {
      const target = targets[targetIndex];
      return target !== void 0 && canInferBetweenAnchors(target);
    });
    if (!inferable) continue;
    sourceIndices.forEach((sourceIndex, offset) => {
      const targetIndex = targetIndices[offset];
      if (targetIndex === void 0) return;
      result[sourceIndex] = {
        sourceIndex,
        targetIndices: [targetIndex],
        state: "supported",
        evidence: [{
          code: "bounded_by_two_anchors",
          reason: `Order is bounded by reliable mappings ${left.sourceIndex}->${left.targetIndex} and ${right.sourceIndex}->${right.targetIndex}`,
          sourceIndex,
          targetIndex
        }],
        alternatives: []
      };
      usedTargets.add(targetIndex);
    });
  }
  return result;
}
function alignEpisodeSequences(sourceSequence, targetSequence, anchors = []) {
  const sources = parseSequence(sourceSequence);
  const targets = parseSequence(targetSequence);
  const manual = manualMappings(sources.length, targets.length, anchors);
  const initial = sources.map((source, sourceIndex) => manual.mappings.get(sourceIndex) ?? automaticMapping(sourceIndex, source, targets));
  const ordered = markOrderConflicts(initial, sources, targets);
  const mappings = ordered.evidence.length === 0 ? inferBoundedMappings(ordered.mappings, sources, targets) : ordered.mappings;
  const evidence = [
    ...manual.evidence,
    ...ordered.evidence,
    ...mappings.flatMap((mapping) => mapping.evidence)
  ];
  const reliableAnchorCount = mappings.filter(
    (mapping) => mapping.state === "confirmed" && mapping.targetIndices.length > 0
  ).length;
  const hasConflict = manual.evidence.some((item) => item.code === "anchor_conflict") || mappings.some((mapping) => mapping.state === "conflicting");
  const mappedCount = mappings.filter(
    (mapping) => mapping.state === "confirmed" || mapping.state === "supported"
  ).length;
  return {
    state: hasConflict ? "conflicting" : mappings.length > 0 && mappedCount === mappings.length ? "aligned" : mappedCount > 0 ? "partial" : "uncertain",
    mappings,
    reliableAnchorCount,
    evidence
  };
}
var EpisodeAligner = class {
  align(sourceSequence, targetSequence, anchors = []) {
    return alignEpisodeSequences(sourceSequence, targetSequence, anchors);
  }
};

// src/core/episode/episode-resolver.ts
function sameSourceCoordinate(left, right) {
  const samePosition = left.sourceKey === right.sourceKey && left.vodId === right.vodId && left.playGroup === right.playGroup && left.playGroupIndex === right.playGroupIndex && left.rawIndex === right.rawIndex;
  if (!samePosition) return false;
  const leftName = left.rawEpisodeName.trim();
  const rightName = right.rawEpisodeName.trim();
  return leftName || rightName ? left.rawEpisodeName === right.rawEpisodeName : left.rawEntry === right.rawEntry;
}
function matchingSourceIndices(sourceEpisode, sourceSequence) {
  return sourceSequence.flatMap((candidate, index) => sameSourceCoordinate(candidate, sourceEpisode) ? [index] : []);
}
function canonicalAsParsedEpisode(episode) {
  const parsedTitle = parseEpisode(episode.episodeTitle ?? "");
  const contentType = episode.contentType === "unknown" ? parsedTitle.contentType : episode.contentType;
  const seasonNumber = episode.seasonNumber ?? parsedTitle.seasonNumber;
  const episodeNumber = episode.episodeNumber ?? parsedTitle.episodeNumber;
  const absoluteNumber = episode.absoluteNumber ?? parsedTitle.absoluteNumber;
  const airDate = episode.airDate ?? parsedTitle.airDate;
  const part = episode.part ?? parsedTitle.part;
  const isSpecial = contentType === "special";
  const hasNumber = episodeNumber !== null || absoluteNumber !== null;
  return {
    ...parsedTitle,
    rawName: episode.episodeTitle ?? episode.canonicalEpisodeId,
    contentType,
    seasonNumber,
    episodeNumber,
    absoluteNumber,
    specialNumber: isSpecial ? parsedTitle.specialNumber ?? episodeNumber ?? absoluteNumber : null,
    specialKind: isSpecial ? parsedTitle.specialKind ?? "special" : null,
    airDate,
    episodeTitle: episode.episodeTitle ?? parsedTitle.episodeTitle,
    part,
    numberKind: airDate !== null ? "date" : isSpecial ? "special" : parsedTitle.numberKind !== "none" ? parsedTitle.numberKind : hasNumber ? "episode" : "none",
    confidence: parsedTitle.confidence !== "none" || hasNumber || isSpecial ? "high" : "none",
    ambiguous: parsedTitle.ambiguous
  };
}
function prepareVerifiedMappings(input) {
  const anchors = [];
  const rejectionReasons = [];
  for (const mapping of input.verifiedMappings ?? []) {
    const sourceIndices = matchingSourceIndices(mapping.sourceEpisode, input.sourceSequence);
    if (sourceIndices.length !== 1) {
      rejectionReasons.push(
        sourceIndices.length === 0 ? "A verified mapping references a source episode outside the supplied source sequence" : "A verified mapping does not uniquely identify one source episode in the supplied sequence"
      );
      continue;
    }
    const canonicalIds = [...new Set(mapping.canonicalEpisodeIds)];
    if (canonicalIds.length === 0) {
      rejectionReasons.push("A verified mapping must name at least one canonical episode");
      continue;
    }
    const targetIndices = [];
    for (const canonicalEpisodeId of canonicalIds) {
      const matches = input.candidateEpisodes.flatMap((episode, index) => episode.canonicalEpisodeId === canonicalEpisodeId ? [index] : []);
      if (matches.length !== 1) {
        rejectionReasons.push(
          matches.length === 0 ? `Verified canonical episode ${canonicalEpisodeId} is absent from the candidate sequence` : `Verified canonical episode ${canonicalEpisodeId} is duplicated in the candidate sequence`
        );
        continue;
      }
      const targetIndex = matches[0];
      if (targetIndex !== void 0) targetIndices.push(targetIndex);
    }
    if (targetIndices.length !== canonicalIds.length) continue;
    const sourceIndex = sourceIndices[0];
    if (sourceIndex === void 0) continue;
    anchors.push({
      sourceIndex,
      targetIndices,
      evidence: mapping.evidence?.trim() || "A caller-provided verified mapping confirms this identity"
    });
  }
  return { anchors, rejectionReasons };
}
function alignmentEvidence(evidence, candidateEpisodes) {
  return evidence.map((item) => ({
    ...item,
    canonicalEpisodeId: item.targetIndex === void 0 ? void 0 : candidateEpisodes[item.targetIndex]?.canonicalEpisodeId
  }));
}
function candidateResults(candidateEpisodes, targetIndices, state, evidence, rejectionReasons = []) {
  return [...new Set(targetIndices)].flatMap((targetIndex) => {
    const episode = candidateEpisodes[targetIndex];
    if (!episode) return [];
    const candidateEvidence = evidence.filter((item) => item.targetIndex === void 0 || item.targetIndex === targetIndex);
    return [{ episode, state, evidence: candidateEvidence, rejectionReasons }];
  });
}
function explicitSeasonConflict(source, candidates) {
  if (source.seasonNumber === null) return [];
  return candidates.flatMap((candidate, index) => {
    if (candidate.seasonNumber === null || candidate.seasonNumber === source.seasonNumber) return [];
    const sameEpisodeNumber = source.episodeNumber !== null && candidate.episodeNumber !== null && source.episodeNumber === candidate.episodeNumber;
    const sameAbsoluteNumber = source.absoluteNumber !== null && candidate.absoluteNumber !== null && source.absoluteNumber === candidate.absoluteNumber;
    return sameEpisodeNumber || sameAbsoluteNumber ? [index] : [];
  });
}
function rejectedResult(input, alignment, targetIndices, evidence, rejectionReasons) {
  return {
    state: "rejected",
    sourceEpisode: input.sourceEpisode,
    selectedEpisode: null,
    candidates: candidateResults(
      input.candidateEpisodes,
      targetIndices,
      "rejected",
      evidence,
      rejectionReasons
    ),
    evidence,
    rejectionReasons,
    alignment,
    reason: rejectionReasons.join("; ") || "Episode resolution evidence is conflicting"
  };
}
function mappedResult(input, alignment, targetIndices, state, evidence) {
  const candidates = candidateResults(input.candidateEpisodes, targetIndices, state, evidence);
  return {
    state,
    sourceEpisode: input.sourceEpisode,
    selectedEpisode: candidates.length === 1 ? candidates[0]?.episode ?? null : null,
    candidates,
    evidence,
    rejectionReasons: [],
    alignment,
    reason: state === "verified" ? "A validated caller-provided mapping verifies the canonical episode identity" : "Reliable episode identity or bounded sequence evidence supports the canonical episode"
  };
}
function resolveEpisode(input) {
  const sourceEntries = input.sourceSequence.map((episode) => episode.parsedEpisodeInfo);
  const targetEntries = input.candidateEpisodes.map(canonicalAsParsedEpisode);
  const verified = prepareVerifiedMappings(input);
  const alignment = alignEpisodeSequences(sourceEntries, targetEntries, verified.anchors);
  const sourceIndices = matchingSourceIndices(input.sourceEpisode, input.sourceSequence);
  const sourceIndex = sourceIndices.length === 1 ? sourceIndices[0] : void 0;
  const membershipEvidence = {
    code: sourceIndices.length === 1 ? "source_sequence_membership" : "verified_mapping_conflict",
    reason: sourceIndices.length === 1 ? "The current source episode is uniquely present in the complete source sequence" : sourceIndices.length === 0 ? "The current source episode is absent from the supplied source sequence" : "The current source episode coordinate is duplicated in the supplied source sequence",
    sourceIndex
  };
  if (sourceIndex === void 0) {
    return rejectedResult(input, alignment, [], [membershipEvidence], [membershipEvidence.reason]);
  }
  const mediaConflictIndices = input.candidateEpisodes.flatMap((episode, index) => episode.mediaId === input.canonicalMedia.mediaId ? [] : [index]);
  if (mediaConflictIndices.length > 0) {
    const reasons = mediaConflictIndices.map((index) => {
      const episode = input.candidateEpisodes[index];
      return `Candidate ${episode?.canonicalEpisodeId ?? index} belongs to media ${episode?.mediaId ?? "unknown"}, not ${input.canonicalMedia.mediaId}`;
    });
    const evidence2 = [membershipEvidence, ...mediaConflictIndices.map((index, reasonIndex) => ({
      code: "canonical_media_conflict",
      reason: reasons[reasonIndex] ?? "Candidate media identity conflicts",
      canonicalEpisodeId: input.candidateEpisodes[index]?.canonicalEpisodeId,
      targetIndex: index
    }))];
    return rejectedResult(input, alignment, mediaConflictIndices, evidence2, reasons);
  }
  const canonicalSeasonConflicts = input.canonicalMedia.season === null ? [] : input.candidateEpisodes.flatMap((episode, index) => episode.seasonNumber !== null && episode.seasonNumber !== input.canonicalMedia.season ? [index] : []);
  if (canonicalSeasonConflicts.length > 0) {
    const reasons = canonicalSeasonConflicts.map((index) => `Candidate ${input.candidateEpisodes[index]?.canonicalEpisodeId ?? index} declares season ${input.candidateEpisodes[index]?.seasonNumber}, but canonical media declares season ${input.canonicalMedia.season}`);
    const evidence2 = [membershipEvidence, ...canonicalSeasonConflicts.map((index, reasonIndex) => ({
      code: "explicit_season_conflict",
      reason: reasons[reasonIndex] ?? "Canonical season identity conflicts",
      canonicalEpisodeId: input.candidateEpisodes[index]?.canonicalEpisodeId,
      targetIndex: index
    }))];
    return rejectedResult(input, alignment, canonicalSeasonConflicts, evidence2, reasons);
  }
  if (verified.rejectionReasons.length > 0) {
    const evidence2 = [membershipEvidence, ...verified.rejectionReasons.map((reason) => ({
      code: "verified_mapping_conflict",
      reason
    }))];
    return rejectedResult(input, alignment, [], evidence2, verified.rejectionReasons);
  }
  const mapping = alignment.mappings[sourceIndex];
  if (!mapping) {
    const reason = "The aligner produced no mapping for the current source episode";
    return rejectedResult(input, alignment, [], [membershipEvidence, {
      code: "verified_mapping_conflict",
      reason,
      sourceIndex
    }], [reason]);
  }
  const mappedEvidence = alignmentEvidence(mapping.evidence, input.candidateEpisodes);
  const scopedEvidence = {
    code: "canonical_media_match",
    reason: `All candidate episodes belong to canonical media ${input.canonicalMedia.mediaId}`
  };
  const evidence = [membershipEvidence, scopedEvidence, ...mappedEvidence];
  const verifiedCurrent = verified.anchors.some((anchor) => anchor.sourceIndex === sourceIndex);
  if (mapping.state === "conflicting" || alignment.state === "conflicting") {
    const reasons = mapping.evidence.filter((item) => item.code === "anchor_conflict").map((item) => item.reason);
    if (reasons.length === 0) reasons.push("Episode evidence conflicts with reliable sequence order");
    return rejectedResult(input, alignment, mapping.alternatives, evidence, reasons);
  }
  if (verifiedCurrent) {
    const verifiedEvidence = [
      ...evidence,
      ...mapping.targetIndices.map((targetIndex) => ({
        code: "verified_mapping",
        reason: "The source identity and canonical episode ID were both validated before using this mapping",
        canonicalEpisodeId: input.candidateEpisodes[targetIndex]?.canonicalEpisodeId,
        sourceIndex,
        targetIndex
      }))
    ];
    return mappedResult(input, alignment, mapping.targetIndices, "verified", verifiedEvidence);
  }
  if (input.canonicalMedia.season !== null && input.sourceEpisode.parsedEpisodeInfo.seasonNumber !== null && input.canonicalMedia.season !== input.sourceEpisode.parsedEpisodeInfo.seasonNumber) {
    const reason = `Source episode declares season ${input.sourceEpisode.parsedEpisodeInfo.seasonNumber}, but canonical media declares season ${input.canonicalMedia.season}`;
    return rejectedResult(input, alignment, [], [...evidence, {
      code: "explicit_season_conflict",
      reason,
      sourceIndex
    }], [reason]);
  }
  const seasonConflicts = explicitSeasonConflict(
    input.sourceEpisode.parsedEpisodeInfo,
    input.candidateEpisodes
  );
  if (mapping.state === "unmatched" && seasonConflicts.length > 0) {
    const reasons = seasonConflicts.map((index) => {
      const candidate = input.candidateEpisodes[index];
      return `Episode number agrees with ${candidate?.canonicalEpisodeId ?? index}, but explicit seasons ${input.sourceEpisode.parsedEpisodeInfo.seasonNumber} and ${candidate?.seasonNumber} conflict`;
    });
    const conflictEvidence = [...evidence, ...seasonConflicts.map((index, reasonIndex) => ({
      code: "explicit_season_conflict",
      reason: reasons[reasonIndex] ?? "Explicit episode seasons conflict",
      canonicalEpisodeId: input.candidateEpisodes[index]?.canonicalEpisodeId,
      sourceIndex,
      targetIndex: index
    }))];
    return rejectedResult(input, alignment, seasonConflicts, conflictEvidence, reasons);
  }
  if (mapping.state === "confirmed" || mapping.state === "supported") {
    return mappedResult(input, alignment, mapping.targetIndices, "supported", evidence);
  }
  if (mapping.state === "unmatched") {
    return {
      state: "not_found",
      sourceEpisode: input.sourceEpisode,
      selectedEpisode: null,
      candidates: [],
      evidence,
      rejectionReasons: [],
      alignment,
      reason: "The source episode has a reliable identity that is absent from the canonical candidates"
    };
  }
  return {
    state: "uncertain",
    sourceEpisode: input.sourceEpisode,
    selectedEpisode: null,
    candidates: candidateResults(
      input.candidateEpisodes,
      mapping.targetIndices,
      "uncertain",
      evidence
    ),
    evidence,
    rejectionReasons: [],
    alignment,
    reason: mapping.targetIndices.length > 0 ? "Available evidence leaves multiple or title-only canonical candidates" : "The source episode has insufficient identity evidence"
  };
}
var EpisodeResolver = class {
  resolve(input) {
    return resolveEpisode(input);
  }
};

// src/core/source/source-normalizer.ts
var HTML_ENTITIES = {
  "&amp;": "&",
  "&nbsp;": " ",
  "&#36;": "$",
  "&quot;": '"',
  "&#39;": "'"
};
function stringValue(value) {
  if (value === null || value === void 0) return "";
  return String(value);
}
function cleanText(value) {
  let result = stringValue(value).replace(/<[^>]*>/g, " ");
  for (const [entity, replacement] of Object.entries(HTML_ENTITIES)) {
    result = result.replaceAll(entity, replacement);
  }
  return result.replace(/\s+/g, " ").trim();
}
function splitPeople(value) {
  const seen = /* @__PURE__ */ new Set();
  return cleanText(value).split(/[,，、/|;；]+/).map((item) => item.trim()).filter((item) => {
    if (!item || seen.has(item)) return false;
    seen.add(item);
    return true;
  });
}
function parseYear(value) {
  const match = cleanText(value).match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/);
  return match ? Number(match[1]) : null;
}
function classifyMediaType(category) {
  const value = cleanText(category).toLowerCase();
  if (!value) return "unknown";
  if (/(动漫|动画|anime)/i.test(value)) return "anime";
  if (/(综艺|真人秀|variety)/i.test(value)) return "variety";
  if (/(纪录片|纪录|documentary)/i.test(value)) return "documentary";
  if (/(电影|影片|movie)/i.test(value)) return "movie";
  if (/(电视剧|连续剧|剧集|欧美剧|国产剧|日韩剧|tv)/i.test(value)) return "series";
  return "unknown";
}
function parseSourceEpisodeNumber(rawEpisodeName, mediaType = "unknown") {
  return parseEpisode(stringValue(rawEpisodeName), { mediaType });
}
function isPlayableUrl(value) {
  return /^https?:\/\//i.test(value.trim());
}
function parseEpisodeEntry(rawEntry, rawIndex, group, mediaType) {
  if (!rawEntry.trim()) return null;
  const separatorIndex = rawEntry.indexOf("$");
  const rawName = separatorIndex >= 0 ? rawEntry.slice(0, separatorIndex) : "";
  const playUrl = (separatorIndex >= 0 ? rawEntry.slice(separatorIndex + 1) : rawEntry).trim();
  if (!isPlayableUrl(playUrl)) return null;
  const cleanedName = cleanText(rawName);
  return {
    sourceKey: group.sourceKey,
    vodId: group.vodId,
    playGroup: group.displayName,
    playGroupIndex: group.rawIndex,
    rawIndex,
    rawEpisodeName: rawName,
    displayName: cleanedName || `\u64AD\u653E\u9879 ${rawIndex + 1}`,
    rawEntry,
    playUrl,
    parsedEpisodeInfo: parseSourceEpisodeNumber(rawName, mediaType),
    canonicalEpisodeId: null,
    mappingState: "unmapped",
    mappingEvidence: []
  };
}
function parseAppleCmsPlaySources(sourceKey, vodId, vodPlayFrom, vodPlayUrl, mediaType = "unknown") {
  const rawFrom = stringValue(vodPlayFrom);
  const rawUrl = stringValue(vodPlayUrl);
  if (!rawUrl) return [];
  const groupNames = rawFrom.split("$$$");
  return rawUrl.split("$$$").map((rawValue, rawIndex) => {
    const rawName = groupNames[rawIndex] ?? "";
    const displayName = cleanText(rawName) || `\u64AD\u653E\u6E90 ${rawIndex + 1}`;
    const groupBase = { sourceKey, vodId, rawIndex, displayName };
    const episodes = rawValue.split("#").map((entry, episodeIndex) => parseEpisodeEntry(entry, episodeIndex, groupBase, mediaType)).filter((episode) => episode !== null);
    if (episodes.length === 0) return null;
    return {
      ...groupBase,
      rawName,
      rawValue,
      episodes
    };
  }).filter((group) => group !== null);
}
var SourceNormalizer = class {
  static normalize(raw, context) {
    const vodId = stringValue(raw.vod_id).trim();
    const rawTitle = stringValue(raw.vod_name);
    const rawYear = stringValue(raw.vod_year);
    const rawDirector = stringValue(raw.vod_director);
    const rawActors = stringValue(raw.vod_actor);
    const rawArea = stringValue(raw.vod_area);
    const rawLanguage = stringValue(raw.vod_lang);
    const rawCategory = stringValue(raw.type_name ?? raw.vod_class);
    const rawRemarks = stringValue(raw.vod_remarks);
    const rawDescription = stringValue(raw.vod_content);
    const rawCover = stringValue(raw.vod_pic);
    const vodPlayFrom = stringValue(raw.vod_play_from);
    const vodPlayUrl = stringValue(raw.vod_play_url);
    const mediaType = classifyMediaType(rawCategory);
    const parsedTitle = parseTitle(rawTitle);
    const parsedRemarks = parseTitle(rawRemarks);
    return {
      sourceKey: context.sourceKey,
      sourceName: context.sourceName ?? context.sourceKey,
      vodId,
      rawTitle,
      rawYear,
      rawDirector,
      rawActors,
      rawArea,
      rawLanguage,
      rawCategory,
      rawRemarks,
      rawDescription,
      rawCover,
      rawPlaySources: { vodPlayFrom, vodPlayUrl },
      rawData: { ...raw },
      normalizedTitle: cleanText(rawTitle).normalize("NFKC").toLowerCase(),
      normalizedActors: splitPeople(rawActors),
      normalizedDirector: splitPeople(rawDirector),
      parsedYear: parseYear(rawYear),
      parsedSeason: parsedTitle.season ?? parsedRemarks.season,
      mediaType,
      playGroups: parseAppleCmsPlaySources(context.sourceKey, vodId, vodPlayFrom, vodPlayUrl, mediaType),
      fetchedAt: context.fetchedAt ?? Date.now()
    };
  }
};

// src/core/source/apple-cms-adapter.ts
var DEFAULT_ENDPOINT_PATH = "/api.php/provide/vod/";
var DEFAULT_TIMEOUT_MS = 1e4;
function nonNegativeInteger(value) {
  const text = typeof value === "number" ? String(value) : String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
function positiveInteger(value) {
  const parsed = nonNegativeInteger(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function buildEndpointUrl(config, requestKind) {
  const configuredBaseUrl = requestKind === "detail" ? config.detailBaseUrl ?? config.baseUrl : config.baseUrl;
  let base;
  try {
    base = new URL(configuredBaseUrl.trim());
  } catch (error) {
    throw new SourceError("invalid_argument", `\u91C7\u96C6\u6E90 ${config.sourceKey} \u7684 URL \u65E0\u6548`, {
      sourceKey: config.sourceKey,
      cause: error
    });
  }
  if (!/^https?:$/.test(base.protocol)) {
    throw new SourceError("invalid_argument", `\u91C7\u96C6\u6E90 ${config.sourceKey} \u4EC5\u652F\u6301 HTTP(S) URL`, {
      sourceKey: config.sourceKey
    });
  }
  const alreadyProviderEndpoint = /\/api\.php\/provide\/vod\/?$/i.test(base.pathname);
  if (!alreadyProviderEndpoint) {
    const basePath = base.pathname.replace(/\/+$/, "");
    const configuredEndpointPath = requestKind === "detail" ? config.detailEndpointPath ?? config.endpointPath : config.endpointPath;
    const endpointPath = (configuredEndpointPath ?? DEFAULT_ENDPOINT_PATH).trim().replace(/^\/+/, "").replace(/\/+$/, "");
    base.pathname = `${basePath}/${endpointPath}/`.replace(/\/{2,}/g, "/");
  }
  base.hash = "";
  for (const [key, value] of Object.entries(config.query ?? {})) {
    base.searchParams.set(key, value);
  }
  return base;
}
function normalizeResponse(raw, sourceKey, requestedPage) {
  if (!isRecord(raw) || !Array.isArray(raw.list)) {
    throw new SourceError("invalid_response", `\u91C7\u96C6\u6E90 ${sourceKey} \u8FD4\u56DE\u7684\u6570\u636E\u683C\u5F0F\u65E0\u6548`, { sourceKey });
  }
  if (!raw.list.every(isRecord)) {
    throw new SourceError("invalid_response", `\u91C7\u96C6\u6E90 ${sourceKey} \u8FD4\u56DE\u4E86\u65E0\u6548\u7684\u5F71\u89C6\u8BB0\u5F55`, { sourceKey });
  }
  if (raw.list.some((item) => {
    const vodId = item.vod_id;
    return !(typeof vodId === "string" && vodId.trim().length > 0 || typeof vodId === "number" && Number.isFinite(vodId));
  })) {
    throw new SourceError("invalid_response", `\u91C7\u96C6\u6E90 ${sourceKey} \u8FD4\u56DE\u4E86\u7F3A\u5C11 vod_id \u7684\u5F71\u89C6\u8BB0\u5F55`, { sourceKey });
  }
  return {
    list: raw.list,
    page: positiveInteger(raw.page) ?? requestedPage,
    pageCount: nonNegativeInteger(raw.pagecount ?? raw.page_count),
    total: nonNegativeInteger(raw.total)
  };
}
var AppleCMSAdapter = class {
  constructor(config, dependencies = {}) {
    __publicField(this, "sourceKey");
    __publicField(this, "sourceName");
    __publicField(this, "config");
    __publicField(this, "fetchFn");
    __publicField(this, "now");
    __publicField(this, "transformRequestUrl");
    if (!config.sourceKey.trim() || !config.sourceName.trim()) {
      throw new SourceError("invalid_argument", "\u91C7\u96C6\u6E90\u5FC5\u987B\u63D0\u4F9B sourceKey \u548C sourceName");
    }
    if (!Number.isFinite(config.timeoutMs ?? DEFAULT_TIMEOUT_MS) || (config.timeoutMs ?? DEFAULT_TIMEOUT_MS) <= 0) {
      throw new SourceError("invalid_argument", `\u91C7\u96C6\u6E90 ${config.sourceKey} \u7684 timeoutMs \u65E0\u6548`, {
        sourceKey: config.sourceKey
      });
    }
    const fetchFn = dependencies.fetch ?? globalThis.fetch;
    if (typeof fetchFn !== "function") {
      throw new SourceError("invalid_argument", "\u5F53\u524D\u73AF\u5883\u6CA1\u6709\u53EF\u7528\u7684 fetch\uFF0C\u8BF7\u663E\u5F0F\u6CE8\u5165");
    }
    buildEndpointUrl(config, "search");
    buildEndpointUrl(config, "detail");
    this.config = config;
    this.sourceKey = config.sourceKey;
    this.sourceName = config.sourceName;
    this.fetchFn = fetchFn.bind(globalThis);
    this.now = dependencies.now ?? Date.now;
    this.transformRequestUrl = dependencies.transformRequestUrl ?? ((url) => url);
  }
  async search(query, options = {}) {
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      throw new SourceError("invalid_argument", "\u641C\u7D22\u5173\u952E\u8BCD\u4E0D\u80FD\u4E3A\u7A7A", { sourceKey: this.sourceKey });
    }
    const page = options.page ?? 1;
    if (!Number.isSafeInteger(page) || page < 1) {
      throw new SourceError("invalid_argument", "\u641C\u7D22\u9875\u7801\u5FC5\u987B\u662F\u6B63\u6574\u6570", { sourceKey: this.sourceKey });
    }
    const url = this.createRequestUrl("search", {
      ac: this.config.searchAction ?? "videolist",
      wd: cleanQuery,
      pg: String(page)
    });
    const response = normalizeResponse(await this.requestJson(url, options), this.sourceKey, page);
    const fetchedAt = this.now();
    return {
      sourceKey: this.sourceKey,
      page: response.page,
      pageCount: response.pageCount,
      total: response.total,
      records: response.list.map((record) => SourceNormalizer.normalize(record, {
        sourceKey: this.sourceKey,
        sourceName: this.sourceName,
        fetchedAt
      }))
    };
  }
  async detail(vodId, options = {}) {
    const cleanVodId = vodId.trim();
    if (!cleanVodId) {
      throw new SourceError("invalid_argument", "vodId \u4E0D\u80FD\u4E3A\u7A7A", { sourceKey: this.sourceKey });
    }
    const url = this.createRequestUrl("detail", {
      ac: this.config.detailAction ?? "videolist",
      ids: cleanVodId
    });
    const response = normalizeResponse(await this.requestJson(url, options), this.sourceKey, 1);
    const record = response.list.find((item) => String(item.vod_id ?? "").trim() === cleanVodId);
    if (!record) {
      throw new SourceError("record_not_found", `\u91C7\u96C6\u6E90 ${this.sourceKey} \u672A\u8FD4\u56DE vodId=${cleanVodId}`, {
        sourceKey: this.sourceKey
      });
    }
    return SourceNormalizer.normalize(record, {
      sourceKey: this.sourceKey,
      sourceName: this.sourceName,
      fetchedAt: this.now()
    });
  }
  createRequestUrl(requestKind, params) {
    const url = buildEndpointUrl(this.config, requestKind);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }
  async requestJson(upstreamUrl, options) {
    if (options.signal?.aborted) {
      throw new SourceError("aborted", `\u91C7\u96C6\u6E90 ${this.sourceKey} \u8BF7\u6C42\u5DF2\u53D6\u6D88`, {
        sourceKey: this.sourceKey,
        cause: options.signal.reason
      });
    }
    const controller = new AbortController();
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let timedOut = false;
    let rejectOnAbort = () => void 0;
    const abortPromise = new Promise((_resolve, reject) => {
      rejectOnAbort = () => {
        if (timedOut) {
          reject(new SourceError("timeout", `\u91C7\u96C6\u6E90 ${this.sourceKey} \u8BF7\u6C42\u8D85\u65F6`, {
            sourceKey: this.sourceKey,
            retryable: true
          }));
          return;
        }
        reject(new SourceError("aborted", `\u91C7\u96C6\u6E90 ${this.sourceKey} \u8BF7\u6C42\u5DF2\u53D6\u6D88`, {
          sourceKey: this.sourceKey,
          cause: options.signal?.reason
        }));
      };
      controller.signal.addEventListener("abort", rejectOnAbort, { once: true });
    });
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort("timeout");
    }, timeoutMs);
    const abortFromCaller = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
    if (options.signal?.aborted) abortFromCaller();
    try {
      const requestPromise = (async () => {
        const requestUrl = await this.transformRequestUrl(upstreamUrl);
        const response = await this.fetchFn(requestUrl, {
          headers: {
            Accept: "application/json",
            ...this.config.headers
          },
          signal: controller.signal
        });
        if (!response.ok) {
          throw new SourceError("http_error", `\u91C7\u96C6\u6E90 ${this.sourceKey} \u8BF7\u6C42\u5931\u8D25: HTTP ${response.status}`, {
            sourceKey: this.sourceKey,
            status: response.status,
            retryable: response.status === 408 || response.status === 429 || response.status >= 500
          });
        }
        try {
          return await response.json();
        } catch (error) {
          throw new SourceError("invalid_response", `\u91C7\u96C6\u6E90 ${this.sourceKey} \u8FD4\u56DE\u7684\u5185\u5BB9\u4E0D\u662F\u6709\u6548 JSON`, {
            sourceKey: this.sourceKey,
            cause: error
          });
        }
      })();
      return await Promise.race([requestPromise, abortPromise]);
    } catch (error) {
      if (error instanceof SourceError) throw error;
      if (options.signal?.aborted) {
        throw new SourceError("aborted", `\u91C7\u96C6\u6E90 ${this.sourceKey} \u8BF7\u6C42\u5DF2\u53D6\u6D88`, {
          sourceKey: this.sourceKey,
          cause: error
        });
      }
      if (controller.signal.aborted) {
        throw new SourceError("timeout", `\u91C7\u96C6\u6E90 ${this.sourceKey} \u8BF7\u6C42\u8D85\u65F6`, {
          sourceKey: this.sourceKey,
          retryable: true,
          cause: error
        });
      }
      throw new SourceError("network_error", `\u91C7\u96C6\u6E90 ${this.sourceKey} \u7F51\u7EDC\u8BF7\u6C42\u5931\u8D25`, {
        sourceKey: this.sourceKey,
        retryable: true,
        cause: error
      });
    } finally {
      clearTimeout(timeoutId);
      options.signal?.removeEventListener("abort", abortFromCaller);
      controller.signal.removeEventListener("abort", rejectOnAbort);
    }
  }
};

// src/core/source/source-manager.ts
var DEFAULT_CONCURRENCY = 5;
var DEFAULT_TIMEOUT_MS2 = 1e4;
var DEFAULT_CACHE_TTL_MS = 3e4;
var DEFAULT_CACHE_MAX_ENTRIES = 100;
function asSourceError(error, sourceKey) {
  if (error instanceof SourceError) return error;
  return new SourceError("network_error", `\u91C7\u96C6\u6E90 ${sourceKey} \u8BF7\u6C42\u5931\u8D25`, {
    sourceKey,
    retryable: true,
    cause: error
  });
}
var SourceManager = class {
  constructor(adapters, options = {}) {
    __publicField(this, "adapters", /* @__PURE__ */ new Map());
    __publicField(this, "concurrency");
    __publicField(this, "timeoutMs");
    __publicField(this, "cacheTtlMs");
    __publicField(this, "cacheMaxEntries");
    __publicField(this, "now");
    __publicField(this, "cache", /* @__PURE__ */ new Map());
    this.concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS2;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.cacheMaxEntries = options.cacheMaxEntries ?? DEFAULT_CACHE_MAX_ENTRIES;
    this.now = options.now ?? Date.now;
    if (!Number.isSafeInteger(this.concurrency) || this.concurrency < 1) {
      throw new SourceError("invalid_argument", "SourceManager concurrency \u5FC5\u987B\u662F\u6B63\u6574\u6570");
    }
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new SourceError("invalid_argument", "SourceManager timeoutMs \u5FC5\u987B\u662F\u6B63\u6570");
    }
    if (!Number.isFinite(this.cacheTtlMs) || this.cacheTtlMs < 0) {
      throw new SourceError("invalid_argument", "SourceManager cacheTtlMs \u4E0D\u80FD\u4E3A\u8D1F\u6570");
    }
    if (!Number.isSafeInteger(this.cacheMaxEntries) || this.cacheMaxEntries < 0) {
      throw new SourceError("invalid_argument", "SourceManager cacheMaxEntries \u4E0D\u80FD\u4E3A\u8D1F\u6570");
    }
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.sourceKey)) {
        throw new SourceError("invalid_argument", `\u91CD\u590D\u7684\u91C7\u96C6\u6E90 sourceKey: ${adapter.sourceKey}`);
      }
      this.adapters.set(adapter.sourceKey, adapter);
    }
  }
  get sourceKeys() {
    return [...this.adapters.keys()];
  }
  async search(query, options = {}) {
    const cleanQuery = query.trim();
    if (!cleanQuery) throw new SourceError("invalid_argument", "\u641C\u7D22\u5173\u952E\u8BCD\u4E0D\u80FD\u4E3A\u7A7A");
    const page = options.page ?? 1;
    if (!Number.isSafeInteger(page) || page < 1) {
      throw new SourceError("invalid_argument", "\u641C\u7D22\u9875\u7801\u5FC5\u987B\u662F\u6B63\u6574\u6570");
    }
    const sourceKeys = options.sourceKeys ? [...new Set(options.sourceKeys)] : this.sourceKeys;
    for (const sourceKey of sourceKeys) this.requireAdapter(sourceKey);
    const pages = [];
    const failures = [];
    let cursor = 0;
    const workerCount = Math.min(this.concurrency, sourceKeys.length);
    const worker = async () => {
      while (cursor < sourceKeys.length) {
        if (options.signal?.aborted) {
          throw new SourceError("aborted", "\u591A\u6E90\u641C\u7D22\u5DF2\u53D6\u6D88", { cause: options.signal.reason });
        }
        const sourceKey = sourceKeys[cursor];
        cursor += 1;
        if (sourceKey === void 0) break;
        const adapter = this.requireAdapter(sourceKey);
        try {
          const result = await this.getOrLoad(
            `search:${sourceKey}:${page}:${cleanQuery}`,
            () => this.runAdapterRequest(
              sourceKey,
              options.signal,
              (signal) => adapter.search(cleanQuery, { page, signal })
            )
          );
          pages.push(result);
          options.onSourceResult?.({ sourceKey, page: result });
        } catch (error) {
          const sourceError = asSourceError(error, sourceKey);
          if (sourceError.code === "aborted" && options.signal?.aborted) throw sourceError;
          failures.push({ sourceKey, error: sourceError });
          options.onSourceResult?.({ sourceKey, error: sourceError });
        }
      }
    };
    await Promise.all(Array.from({ length: workerCount }, worker));
    return {
      records: pages.flatMap((result) => result.records),
      pages,
      failures
    };
  }
  async detail(sourceKey, vodId, signal) {
    const adapter = this.requireAdapter(sourceKey);
    const cleanVodId = vodId.trim();
    if (!cleanVodId) {
      throw new SourceError("invalid_argument", "vodId \u4E0D\u80FD\u4E3A\u7A7A", { sourceKey });
    }
    return this.getOrLoad(
      `detail:${sourceKey}:${cleanVodId}`,
      () => this.runAdapterRequest(
        sourceKey,
        signal,
        (requestSignal) => adapter.detail(cleanVodId, { signal: requestSignal })
      )
    );
  }
  clearCache(sourceKey) {
    if (!sourceKey) {
      this.cache.clear();
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.startsWith(`search:${sourceKey}:`) || key.startsWith(`detail:${sourceKey}:`)) {
        this.cache.delete(key);
      }
    }
  }
  requireAdapter(sourceKey) {
    const adapter = this.adapters.get(sourceKey);
    if (!adapter) {
      throw new SourceError("unknown_source", `\u672A\u77E5\u91C7\u96C6\u6E90: ${sourceKey}`, { sourceKey });
    }
    return adapter;
  }
  async getOrLoad(key, load) {
    const cached = this.cache.get(key);
    const now = this.now();
    if (cached && cached.expiresAt > now) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached.value;
    }
    if (cached) this.cache.delete(key);
    const value = await load();
    if (this.cacheTtlMs > 0 && this.cacheMaxEntries > 0) {
      this.cache.set(key, { value, expiresAt: this.now() + this.cacheTtlMs });
      this.pruneCache();
    }
    return value;
  }
  async runAdapterRequest(sourceKey, parentSignal, operation) {
    if (parentSignal?.aborted) {
      throw new SourceError("aborted", `\u91C7\u96C6\u6E90 ${sourceKey} \u8BF7\u6C42\u5DF2\u53D6\u6D88`, {
        sourceKey,
        cause: parentSignal.reason
      });
    }
    const controller = new AbortController();
    let timedOut = false;
    let rejectOnAbort = () => void 0;
    const abortPromise = new Promise((_resolve, reject) => {
      rejectOnAbort = () => {
        if (timedOut) {
          reject(new SourceError("timeout", `\u91C7\u96C6\u6E90 ${sourceKey} \u8BF7\u6C42\u8D85\u65F6`, {
            sourceKey,
            retryable: true
          }));
          return;
        }
        reject(new SourceError("aborted", `\u91C7\u96C6\u6E90 ${sourceKey} \u8BF7\u6C42\u5DF2\u53D6\u6D88`, {
          sourceKey,
          cause: parentSignal?.reason
        }));
      };
      controller.signal.addEventListener("abort", rejectOnAbort, { once: true });
    });
    const abortFromParent = () => controller.abort(parentSignal?.reason);
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort("timeout");
    }, this.timeoutMs);
    try {
      const operationPromise = Promise.resolve().then(() => operation(controller.signal));
      return await Promise.race([operationPromise, abortPromise]);
    } catch (error) {
      if (error instanceof SourceError) throw error;
      if (timedOut) {
        throw new SourceError("timeout", `\u91C7\u96C6\u6E90 ${sourceKey} \u8BF7\u6C42\u8D85\u65F6`, {
          sourceKey,
          retryable: true,
          cause: error
        });
      }
      if (parentSignal?.aborted) {
        throw new SourceError("aborted", `\u91C7\u96C6\u6E90 ${sourceKey} \u8BF7\u6C42\u5DF2\u53D6\u6D88`, {
          sourceKey,
          cause: error
        });
      }
      throw asSourceError(error, sourceKey);
    } finally {
      clearTimeout(timeoutId);
      parentSignal?.removeEventListener("abort", abortFromParent);
      controller.signal.removeEventListener("abort", rejectOnAbort);
    }
  }
  pruneCache() {
    const now = this.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key);
    }
    while (this.cache.size > this.cacheMaxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === void 0) break;
      this.cache.delete(oldestKey);
    }
  }
};

// src/core/danmaku/danmu-client.ts
var DanmuTimeoutError = class extends Error {
};
var DanmuAbortError = class extends Error {
};
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringValue2(value) {
  if (typeof value === "string") return value;
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}
function nullableString(value) {
  const result = stringValue2(value).trim();
  return result || null;
}
function nullableNumber(value) {
  if (value === null || value === void 0) return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  if (typeof value === "string" && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(value.trim())) {
    return null;
  }
  const result = typeof value === "number" ? value : Number(value.trim());
  return Number.isFinite(result) ? result : null;
}
function validOptionalNumber(value, options = {}) {
  if (value === null || value === void 0 || typeof value === "string" && value.trim() === "") {
    return true;
  }
  const parsed = nullableNumber(value);
  return parsed !== null && (!options.integer || Number.isInteger(parsed)) && (!options.nonNegative || parsed >= 0);
}
function retryAfterMs(headers) {
  const value = headers.get("retry-after");
  if (!value) return void 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1e3;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : void 0;
}
function errorResult(kind, status, message, retryAfter) {
  const error = {
    kind,
    status,
    message,
    ...retryAfter === void 0 ? {} : { retryAfterMs: retryAfter }
  };
  return { ok: false, status, error };
}
function envelopeError(value, status) {
  if (!isRecord2(value) || value.success !== false) return null;
  const code = Number(value.errorCode);
  const effectiveStatus = Number.isFinite(code) && code >= 400 ? code : status;
  const kind = effectiveStatus === 429 ? "rate-limited" : effectiveStatus >= 500 ? "server-error" : effectiveStatus >= 400 ? "client-error" : "invalid-response";
  return errorResult(kind, effectiveStatus, stringValue2(value.errorMessage) || "danmu_api rejected the request");
}
function mediaFields(raw) {
  return {
    animeId: nullableString(raw.animeId) ?? "",
    bangumiId: nullableString(raw.bangumiId) ?? "",
    animeTitle: nullableString(raw.animeTitle) ?? "",
    type: nullableString(raw.type) ?? "",
    typeDescription: nullableString(raw.typeDescription) ?? "",
    imageUrl: nullableString(raw.imageUrl) ?? "",
    startDate: nullableString(raw.startDate) ?? "",
    episodeCount: nullableNumber(raw.episodeCount),
    source: nullableString(raw.source) ?? ""
  };
}
function parseSearchAnime(value) {
  if (!isRecord2(value)) return null;
  if (!validOptionalNumber(value.episodeCount, { integer: true, nonNegative: true })) return null;
  const fields = mediaFields(value);
  if (!fields.animeId || !fields.animeTitle) return null;
  return { ...fields, rawData: { ...value } };
}
function parseMatchCandidate(value) {
  if (!isRecord2(value)) return null;
  const animeId = nullableString(value.animeId) ?? "";
  const episodeId = nullableString(value.episodeId) ?? "";
  const animeTitle = nullableString(value.animeTitle) ?? "";
  if (!animeId || !episodeId || !animeTitle || !validOptionalNumber(value.shift)) return null;
  return {
    animeId,
    animeTitle,
    episodeId,
    episodeTitle: nullableString(value.episodeTitle) ?? "",
    type: nullableString(value.type) ?? "",
    typeDescription: nullableString(value.typeDescription) ?? "",
    shift: nullableNumber(value.shift) ?? 0,
    imageUrl: nullableString(value.imageUrl) ?? "",
    url: nullableString(value.url) ?? "",
    rawData: { ...value }
  };
}
function parseEpisode2(value, animeId, rawIndex) {
  if (!isRecord2(value)) return null;
  const episodeId = nullableString(value.episodeId) ?? "";
  if (!episodeId) return null;
  return {
    animeId,
    rawIndex,
    seasonId: nullableString(value.seasonId) ?? "",
    episodeId,
    episodeTitle: nullableString(value.episodeTitle) ?? "",
    apiEpisodeNumber: nullableString(value.episodeNumber),
    airDate: nullableString(value.airDate),
    url: nullableString(value.url) ?? "",
    rawData: { ...value }
  };
}
function parseComment(value) {
  if (!isRecord2(value) || typeof value.p !== "string" || typeof value.m !== "string") return null;
  return { p: value.p, m: value.m, rawData: { ...value } };
}
var DanmuClient = class {
  constructor(options) {
    __publicField(this, "baseUrl");
    __publicField(this, "fetchImpl");
    __publicField(this, "timeoutMs");
    __publicField(this, "headers");
    this.baseUrl = options.baseUrl.trim().replace(/\/+$/, "");
    if (!this.baseUrl) throw new TypeError("DanmuClient baseUrl is required");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== "function") throw new TypeError("DanmuClient fetch implementation is required");
    this.timeoutMs = options.timeoutMs ?? 1e4;
    this.headers = new Headers(options.headers);
  }
  async match(fileName, options = {}) {
    const query = fileName.trim();
    if (!query) return errorResult("client-error", 400, "fileName is required");
    const response = await this.requestJson("/api/v2/match", {
      method: "POST",
      body: JSON.stringify({ fileName: query }),
      headers: { "content-type": "application/json" }
    }, options.signal);
    if (!response.ok) return response;
    const envelope = envelopeError(response.data.value, response.data.status);
    if (envelope) return envelope;
    const value = response.data.value;
    if (!isRecord2(value) || typeof value.isMatched !== "boolean" || !Array.isArray(value.matches)) {
      return errorResult("invalid-response", response.data.status, "Invalid match response");
    }
    const matches = value.matches.map(parseMatchCandidate).filter((item) => item !== null);
    if (matches.length !== value.matches.length || value.isMatched && matches.length === 0) {
      return errorResult("invalid-response", response.data.status, "Match response contains invalid candidates");
    }
    return { ok: true, status: response.data.status, data: { isMatched: value.isMatched, matches } };
  }
  async searchAnime(keyword, options = {}) {
    const query = keyword.trim();
    if (!query) return errorResult("client-error", 400, "keyword is required");
    const path = `/api/v2/search/anime?keyword=${encodeURIComponent(query)}`;
    const response = await this.requestJson(path, { method: "GET" }, options.signal);
    if (!response.ok) return response;
    const envelope = envelopeError(response.data.value, response.data.status);
    if (envelope) return envelope;
    const value = response.data.value;
    if (!isRecord2(value) || !Array.isArray(value.animes)) {
      return errorResult("invalid-response", response.data.status, "Invalid anime search response");
    }
    const animes = value.animes.map(parseSearchAnime).filter((item) => item !== null);
    if (animes.length !== value.animes.length) {
      return errorResult("invalid-response", response.data.status, "Anime search response contains invalid candidates");
    }
    return { ok: true, status: response.data.status, data: { animes } };
  }
  async getBangumi(animeId, options = {}) {
    const id = animeId.trim();
    if (!id) return errorResult("client-error", 400, "animeId is required");
    const response = await this.requestJson(`/api/v2/bangumi/${encodeURIComponent(id)}`, { method: "GET" }, options.signal);
    if (!response.ok) return response;
    const envelope = envelopeError(response.data.value, response.data.status);
    if (envelope) return envelope;
    const value = response.data.value;
    if (!isRecord2(value) || !isRecord2(value.bangumi) || !Array.isArray(value.bangumi.episodes)) {
      return errorResult("invalid-response", response.data.status, "Invalid bangumi response");
    }
    const raw = value.bangumi;
    const rawEpisodes = raw.episodes;
    if (!Array.isArray(rawEpisodes)) {
      return errorResult("invalid-response", response.data.status, "Bangumi episodes are invalid");
    }
    const normalizedAnimeId = nullableString(raw.animeId) ?? "";
    const normalizedAnimeTitle = nullableString(raw.animeTitle) ?? "";
    if (!normalizedAnimeId || !normalizedAnimeTitle) {
      return errorResult("invalid-response", response.data.status, "Bangumi identity is missing");
    }
    const episodes = rawEpisodes.map((episode, index) => parseEpisode2(episode, normalizedAnimeId, index)).filter((episode) => episode !== null);
    if (episodes.length !== rawEpisodes.length) {
      return errorResult("invalid-response", response.data.status, "Bangumi response contains invalid episodes");
    }
    return {
      ok: true,
      status: response.data.status,
      data: {
        animeId: normalizedAnimeId,
        bangumiId: nullableString(raw.bangumiId) ?? "",
        animeTitle: normalizedAnimeTitle,
        type: nullableString(raw.type) ?? "",
        typeDescription: nullableString(raw.typeDescription) ?? "",
        episodes,
        rawData: { ...raw }
      }
    };
  }
  async getComments(episodeId, options = {}) {
    const id = episodeId.trim();
    if (!id) return errorResult("client-error", 400, "episodeId is required");
    const path = `/api/v2/comment/${encodeURIComponent(id)}?format=json&duration=true`;
    const response = await this.requestJson(path, { method: "GET" }, options.signal);
    if (!response.ok) return response;
    const envelope = envelopeError(response.data.value, response.data.status);
    if (envelope) return envelope;
    const value = response.data.value;
    if (!isRecord2(value) || !Array.isArray(value.comments)) {
      return errorResult("invalid-response", response.data.status, "Invalid comment response");
    }
    if (!validOptionalNumber(value.count, { integer: true, nonNegative: true }) || !validOptionalNumber(value.videoDuration, { nonNegative: true })) {
      return errorResult("invalid-response", response.data.status, "Comment response contains invalid numeric metadata");
    }
    const comments = value.comments.map(parseComment).filter((item) => item !== null);
    if (comments.length !== value.comments.length) {
      return errorResult("invalid-response", response.data.status, "Comment response contains invalid items");
    }
    const count = nullableNumber(value.count) ?? comments.length;
    const videoDuration = nullableNumber(value.videoDuration);
    return { ok: true, status: response.data.status, data: { count, comments, videoDuration } };
  }
  async requestJson(path, init, externalSignal) {
    const controller = new AbortController();
    let didTimeout = false;
    let rejectExternalAbort;
    const externalAbort = new Promise((_resolve, reject) => {
      rejectExternalAbort = reject;
    });
    const abortFromExternal = () => {
      controller.abort(externalSignal?.reason);
      rejectExternalAbort?.(new DanmuAbortError("danmu_api request was aborted"));
    };
    if (externalSignal?.aborted) abortFromExternal();
    else externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
    const headers = new Headers(this.headers);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    let timeoutId;
    try {
      const timeout = new Promise((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          didTimeout = true;
          controller.abort();
          reject(new DanmuTimeoutError(`danmu_api request timed out after ${this.timeoutMs}ms`));
        }, this.timeoutMs);
      });
      const response = await Promise.race([
        this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers, signal: controller.signal }),
        timeout,
        externalAbort
      ]);
      if (!response.ok) {
        const kind = response.status === 429 ? "rate-limited" : response.status >= 500 ? "server-error" : "client-error";
        return errorResult(kind, response.status, `danmu_api returned HTTP ${response.status}`, retryAfterMs(response.headers));
      }
      const text = await Promise.race([response.text(), timeout, externalAbort]);
      if (!text.trim()) return errorResult("invalid-response", response.status, "danmu_api returned an empty response");
      let value;
      try {
        value = JSON.parse(text);
      } catch {
        return errorResult("invalid-response", response.status, "danmu_api returned invalid JSON");
      }
      return { ok: true, status: response.status, data: { status: response.status, headers: response.headers, value } };
    } catch (error) {
      if (didTimeout || error instanceof DanmuTimeoutError) {
        return errorResult("timeout", null, error instanceof Error ? error.message : "danmu_api request timed out");
      }
      if (externalSignal?.aborted || error instanceof DanmuAbortError) {
        return errorResult("aborted", null, "danmu_api request was aborted");
      }
      return errorResult("network-error", null, error instanceof Error ? error.message : "danmu_api network request failed");
    } finally {
      if (timeoutId !== void 0) clearTimeout(timeoutId);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    }
  }
};

// src/core/danmaku/danmu-candidate-resolver.ts
function uniqueStrings2(values) {
  const result = [];
  const seen = /* @__PURE__ */ new Set();
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}
function aliasesFromRawData(rawData) {
  const values = [];
  for (const field of ["aliases", "titles"]) {
    const rawAliases = rawData[field];
    if (Array.isArray(rawAliases)) {
      values.push(...rawAliases.filter((value) => typeof value === "string"));
    }
  }
  return uniqueStrings2(values);
}
function yearFromDate(value) {
  const match = /(?:^|[^\d])((?:19|20)\d{2})(?:[^\d]|$)/u.exec(value);
  return match?.[1] ? Number(match[1]) : null;
}
function mediaTypeFromDanmu(type, typeDescription) {
  const value = `${type} ${typeDescription}`.normalize("NFKC").toLocaleLowerCase("zh-CN");
  const types = /* @__PURE__ */ new Set();
  if (/(?:日番|番剧|动漫|动画|\banime\b|\banimation\b)/iu.test(value)) types.add("anime");
  if (/(?:电影|剧场版|\bmovie\b|\bfilm\b)/iu.test(value)) types.add("movie");
  if (/(?:电视剧|连续剧|韩剧|日剧|美剧|国产剧|\bseries\b|\bdrama\b)/iu.test(value)) {
    types.add("series");
  }
  if (/(?:综艺|\bvariety\b)/iu.test(value)) types.add("variety");
  if (/(?:纪录片|记录片|\bdocumentary\b)/iu.test(value)) types.add("documentary");
  return types.size === 1 ? [...types][0] : void 0;
}
function adaptDanmuMatchCandidate(candidate) {
  return {
    animeId: candidate.animeId,
    animeTitle: candidate.animeTitle,
    aliases: aliasesFromRawData(candidate.rawData),
    mediaType: mediaTypeFromDanmu(candidate.type, candidate.typeDescription),
    source: "match",
    rawData: candidate.rawData
  };
}
function adaptDanmuSearchAnime(candidate) {
  return {
    animeId: candidate.animeId,
    animeTitle: candidate.animeTitle,
    aliases: aliasesFromRawData(candidate.rawData),
    year: yearFromDate(candidate.startDate),
    mediaType: mediaTypeFromDanmu(candidate.type, candidate.typeDescription),
    source: candidate.source || "search",
    rawData: candidate.rawData
  };
}
function adaptDanmakuCandidate(candidate) {
  const parsedTitle = parseTitle(candidate.animeTitle);
  return {
    recordId: `danmu:${candidate.animeId}`,
    rawTitle: candidate.animeTitle,
    parsedTitle,
    aliases: uniqueStrings2([...parsedTitle.aliases, ...candidate.aliases ?? []]),
    year: candidate.year ?? parsedTitle.year,
    season: candidate.season ?? parsedTitle.season,
    mediaType: candidate.mediaType,
    directors: candidate.directors,
    actors: candidate.actors,
    areas: candidate.areas,
    languages: candidate.languages,
    externalIds: {
      ...candidate.externalIds,
      danmu: candidate.animeId
    }
  };
}
function adaptCanonicalMedia(media) {
  return {
    recordId: media.mediaId,
    rawTitle: media.canonicalTitle,
    parsedTitle: parseTitle(media.canonicalTitle),
    aliases: media.aliases,
    year: media.releaseYear,
    season: media.season,
    mediaType: media.mediaType,
    directors: media.directors,
    actors: media.actors,
    externalIds: media.externalIds,
    titleAuthority: "confirmed"
  };
}
function uniqueCandidates(candidates) {
  const seen = /* @__PURE__ */ new Set();
  return candidates.filter((candidate) => {
    const key = candidate.animeId.trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
var DanmuCandidateResolver = class {
  constructor(entityResolver = new EntityResolver()) {
    __publicField(this, "entityResolver", entityResolver);
  }
  resolve(media, candidates, options = {}) {
    const canonicalIdentity = adaptCanonicalMedia(media);
    const unique = uniqueCandidates(candidates);
    const evaluations = unique.map((candidate) => ({
      candidate,
      identity: this.entityResolver.resolve(canonicalIdentity, adaptDanmakuCandidate(candidate))
    }));
    if (options.manualAnimeId !== void 0) {
      const manualAnimeId = options.manualAnimeId.trim();
      const manual = evaluations.find(({ candidate }) => candidate.animeId === manualAnimeId);
      if (!manual) {
        return {
          state: "not_found",
          selected: null,
          selectedBy: null,
          evaluations,
          reason: `The manually selected animeId ${manualAnimeId || "(empty)"} is not present`
        };
      }
      if (manual.identity.decision === "rejected") {
        return {
          state: "conflicting",
          selected: null,
          selectedBy: null,
          evaluations,
          reason: `The manually selected work conflicts with canonical identity: ${manual.identity.reason}`
        };
      }
      return {
        state: manual.identity.decision === "confirmed" ? "verified" : "supported",
        selected: manual.candidate,
        selectedBy: "manual",
        evaluations,
        reason: manual.identity.decision === "confirmed" ? "The manual choice also has a verified external identity" : "The user selected this work; its episode still requires independent resolution"
      };
    }
    if (evaluations.length === 0) {
      return {
        state: "not_found",
        selected: null,
        selectedBy: null,
        evaluations,
        reason: "danmu_api returned no work candidates"
      };
    }
    const viable = evaluations.filter(({ identity }) => identity.decision !== "rejected");
    if (viable.length === 0) {
      return {
        state: "conflicting",
        selected: null,
        selectedBy: null,
        evaluations,
        reason: "Every danmu candidate has explicit identity conflicts"
      };
    }
    const confirmed = viable.filter(({ identity }) => identity.decision === "confirmed");
    if (confirmed.length === 1) {
      return {
        state: "verified",
        selected: confirmed[0]?.candidate ?? null,
        selectedBy: "automatic",
        evaluations,
        reason: confirmed[0]?.identity.reason ?? "A verified external identity selected the work"
      };
    }
    if (viable.length > 1) {
      return {
        state: "uncertain",
        selected: null,
        selectedBy: null,
        evaluations,
        reason: "Multiple non-rejected danmu candidates remain distinguishable only by missing evidence"
      };
    }
    const only = viable[0];
    if (!only || only.identity.decision === "uncertain") {
      return {
        state: "uncertain",
        selected: null,
        selectedBy: null,
        evaluations,
        reason: only?.identity.reason ?? "No candidate has enough evidence for automatic selection"
      };
    }
    return {
      state: only.identity.decision === "confirmed" ? "verified" : "supported",
      selected: only.candidate,
      selectedBy: "automatic",
      evaluations,
      reason: only.identity.reason
    };
  }
};
function resolveDanmakuCandidate(media, candidates, options = {}) {
  return new DanmuCandidateResolver().resolve(media, candidates, options);
}

// src/core/danmaku/danmu-episode-resolver.ts
function parsedCanonicalEpisode(episode, media) {
  const parsedTitle = parseEpisode(episode.episodeTitle ?? "", { mediaType: media.mediaType });
  const contentType = episode.contentType === "unknown" ? parsedTitle.contentType : episode.contentType;
  const seasonNumber = episode.seasonNumber ?? parsedTitle.seasonNumber;
  const episodeNumber = episode.episodeNumber ?? parsedTitle.episodeNumber;
  const absoluteNumber = episode.absoluteNumber ?? parsedTitle.absoluteNumber;
  const airDate = episode.airDate ?? parsedTitle.airDate;
  const part = episode.part ?? parsedTitle.part;
  const hasNumber = episodeNumber !== null || absoluteNumber !== null;
  const isSpecial = contentType === "special";
  return {
    ...parsedTitle,
    rawName: episode.episodeTitle ?? episode.canonicalEpisodeId,
    contentType,
    seasonNumber,
    episodeNumber,
    absoluteNumber,
    specialNumber: isSpecial ? parsedTitle.specialNumber ?? episodeNumber ?? absoluteNumber : null,
    specialKind: isSpecial ? parsedTitle.specialKind ?? "special" : null,
    airDate,
    episodeTitle: episode.episodeTitle ?? parsedTitle.episodeTitle,
    part,
    numberKind: airDate !== null ? "date" : isSpecial ? "special" : parsedTitle.numberKind !== "none" ? parsedTitle.numberKind : hasNumber ? "episode" : "none",
    confidence: parsedTitle.confidence !== "none" || hasNumber || isSpecial ? "high" : "none"
  };
}
function canonicalSourceEpisode(episode, media, coordinate) {
  const rawEpisodeName = episode.episodeTitle ?? episode.canonicalEpisodeId;
  return {
    sourceKey: `canonical:${media.mediaId}`,
    vodId: media.mediaId,
    playGroup: "canonical",
    playGroupIndex: 0,
    // This is only a coordinate used to prove sequence membership. It is never
    // copied into ParsedEpisodeInfo or treated as an episode number.
    rawIndex: coordinate,
    rawEpisodeName,
    displayName: rawEpisodeName,
    rawEntry: episode.canonicalEpisodeId,
    playUrl: "",
    parsedEpisodeInfo: parsedCanonicalEpisode(episode, media),
    canonicalEpisodeId: episode.canonicalEpisodeId,
    mappingState: "mapped",
    mappingEvidence: ["Canonical episode supplied by Danmaku Core"]
  };
}
function adaptDanmuEpisode(episode, media, coordinate) {
  const parsed = parseEpisode(episode.episodeTitle, { mediaType: media.mediaType });
  const parsedAirDate = episode.airDate === null ? null : parseEpisode(episode.airDate, { mediaType: media.mediaType });
  const semanticAirDate = parsed.airDate ?? (parsedAirDate?.numberKind === "date" ? parsedAirDate.airDate : null);
  const rawTitle = episode.episodeTitle.trim();
  const canonical = {
    canonicalEpisodeId: `danmu:${episode.animeId}:${episode.episodeId}:${coordinate}`,
    mediaId: media.mediaId,
    contentType: parsed.contentType,
    seasonNumber: parsed.seasonNumber,
    episodeNumber: parsed.episodeNumber,
    absoluteNumber: parsed.absoluteNumber,
    airDate: semanticAirDate,
    // Preserve the raw upstream title so the shared resolver can parse special
    // identities such as SP/OVA, whose number has no dedicated canonical field.
    episodeTitle: rawTitle || null,
    part: parsed.part,
    identityState: parsed.confidence === "none" && semanticAirDate === null ? "uncertain" : "supported",
    evidence: []
  };
  return { source: episode, canonical };
}
function rejected(reason) {
  return {
    state: "rejected",
    selected: null,
    candidates: [],
    evidence: [],
    rejectionReasons: [reason],
    reason
  };
}
function resolveDanmakuEpisode(input) {
  if (input.targetEpisode.mediaId !== input.media.mediaId) {
    return rejected(
      `Target episode belongs to media ${input.targetEpisode.mediaId}, not ${input.media.mediaId}`
    );
  }
  const foreignCanonicalEpisode = input.canonicalEpisodes.find(
    (episode) => episode.mediaId !== input.media.mediaId
  );
  if (foreignCanonicalEpisode) {
    return rejected(
      `Canonical episode ${foreignCanonicalEpisode.canonicalEpisodeId} belongs to another media`
    );
  }
  const targetCoordinates = input.canonicalEpisodes.flatMap((episode, index) => episode.canonicalEpisodeId === input.targetEpisode.canonicalEpisodeId ? [index] : []);
  if (targetCoordinates.length !== 1) {
    return rejected("The target episode must occur exactly once in the canonical sequence");
  }
  const targetCoordinate = targetCoordinates[0] ?? -1;
  const sourceSequence = input.canonicalEpisodes.map((episode, index) => canonicalSourceEpisode(episode, input.media, index));
  const sourceEpisode = canonicalSourceEpisode(
    input.targetEpisode,
    input.media,
    targetCoordinate ?? -1
  );
  const adaptedDanmuEpisodes = input.danmuEpisodes.map((episode, index) => adaptDanmuEpisode(episode, input.media, index));
  const episodeByCanonicalId = new Map(
    adaptedDanmuEpisodes.map(({ source, canonical }) => [canonical.canonicalEpisodeId, source])
  );
  const isolatedSourceEpisode = canonicalSourceEpisode(input.targetEpisode, input.media, 0);
  const isolatedResolution = resolveEpisode({
    sourceEpisode: isolatedSourceEpisode,
    sourceSequence: [isolatedSourceEpisode],
    canonicalMedia: input.media,
    candidateEpisodes: adaptedDanmuEpisodes.map(({ canonical }) => canonical)
  });
  const isolatedIsDecisive = isolatedResolution.state === "verified" || isolatedResolution.state === "supported" || isolatedResolution.state === "rejected" || isolatedResolution.candidates.length > 1 && isolatedResolution.evidence.some(({ code }) => code === "ambiguous_candidates");
  const resolution = isolatedIsDecisive ? isolatedResolution : resolveEpisode({
    sourceEpisode,
    sourceSequence,
    canonicalMedia: input.media,
    candidateEpisodes: adaptedDanmuEpisodes.map(({ canonical }) => canonical)
  });
  const candidates = resolution.candidates.flatMap(({ episode }) => {
    const original = episodeByCanonicalId.get(episode.canonicalEpisodeId);
    return original ? [original] : [];
  });
  const selected = resolution.selectedEpisode === null ? null : episodeByCanonicalId.get(resolution.selectedEpisode.canonicalEpisodeId) ?? null;
  return {
    state: resolution.state,
    selected,
    candidates,
    evidence: resolution.evidence,
    rejectionReasons: resolution.rejectionReasons,
    reason: resolution.reason
  };
}
var DanmuEpisodeResolver = class {
  resolve(input) {
    return resolveDanmakuEpisode(input);
  }
};

// src/core/danmaku/danmu-service.ts
function emptyResult(state, reason, options = {}) {
  return {
    state,
    binding: options.binding ?? null,
    comments: [],
    videoDuration: options.videoDuration ?? null,
    candidateResolution: options.candidateResolution ?? null,
    episodeResolution: options.episodeResolution ?? null,
    error: options.error ?? null,
    reason
  };
}
function clientErrorState(error) {
  switch (error.kind) {
    case "rate-limited":
    case "client-error":
    case "server-error":
    case "network-error":
    case "timeout":
    case "aborted":
    case "invalid-response":
      return error.kind;
  }
}
function padEpisodeNumber(value) {
  return String(value).padStart(2, "0");
}
function reliableMatchFileName(input) {
  const season = input.media.season;
  const episode = input.episode.episodeNumber;
  if (input.episode.contentType !== "regular" || input.media.mediaType !== "series" && input.media.mediaType !== "anime") {
    return null;
  }
  if (season === null || episode === null || season <= 0 || episode <= 0) return null;
  if (input.episode.seasonNumber !== null && input.episode.seasonNumber !== season) return null;
  return `${input.media.canonicalTitle.trim()} S${padEpisodeNumber(season)}E${padEpisodeNumber(episode)}`;
}
function hasReliableEpisodeIdentity(input) {
  const episode = input.episode;
  if (episode.identityState !== "confirmed" && episode.identityState !== "supported") {
    return false;
  }
  if (episode.episodeNumber !== null || episode.absoluteNumber !== null || episode.airDate !== null) {
    return true;
  }
  const parsed = parseEpisode(episode.episodeTitle ?? "", {
    mediaType: input.media.mediaType
  });
  return parsed.confidence === "high" && (parsed.numberKind !== "none" || parsed.contentType === "movie");
}
function mediaCanResolve(input) {
  return input.media.canonicalTitle.trim() !== "" && (input.media.identityState === "confirmed" || input.media.identityState === "supported");
}
function episodeInputIssue(input) {
  if (input.episode.mediaId !== input.media.mediaId) {
    return {
      state: "episode-rejected",
      reason: "The target episode belongs to another canonical media"
    };
  }
  const occurrences = input.mediaEpisodes.filter(
    (episode) => episode.canonicalEpisodeId === input.episode.canonicalEpisodeId
  );
  if (occurrences.length !== 1) {
    return {
      state: "episode-rejected",
      reason: "The target episode must occur exactly once in the canonical sequence"
    };
  }
  if (input.sourceEpisode.mappingState !== "mapped" || input.sourceEpisode.canonicalEpisodeId === null) {
    return input.sourceEpisode.mappingState === "conflicting" ? {
      state: "episode-rejected",
      reason: "The source episode has a conflicting canonical mapping"
    } : {
      state: "episode-uncertain",
      reason: "The source episode has not been mapped to a canonical episode"
    };
  }
  if (input.sourceEpisode.canonicalEpisodeId !== input.episode.canonicalEpisodeId) {
    return {
      state: "episode-rejected",
      reason: "The source episode is mapped to a different canonical episode"
    };
  }
  if (input.media.season !== null && input.episode.seasonNumber !== null && input.media.season !== input.episode.seasonNumber) {
    return {
      state: "episode-rejected",
      reason: "The canonical media and target episode have conflicting seasons"
    };
  }
  return null;
}
function manualEpisodeInputIssue(input) {
  if (input.manualEpisodeId === void 0) return null;
  if (input.manualCandidate === void 0) {
    return {
      state: "episode-rejected",
      reason: "A manual episode choice requires an explicitly selected danmu work"
    };
  }
  if (input.manualEpisodeId.trim() === "") {
    return {
      state: "episode-rejected",
      reason: "The manually selected danmu episodeId must not be empty"
    };
  }
  return null;
}
function applyManualEpisodeSelection(resolution, episodes, manualEpisodeId) {
  if (resolution.state === "rejected") {
    return {
      ok: false,
      reason: `The manual episode choice cannot override an identity conflict: ${resolution.reason}`
    };
  }
  const episodeId = manualEpisodeId.trim();
  const upstreamMatches = episodes.filter((episode) => episode.episodeId === episodeId);
  if (upstreamMatches.length !== 1) {
    return {
      ok: false,
      reason: upstreamMatches.length === 0 ? `The manually selected episodeId ${episodeId} is not present in the selected work` : `The manually selected episodeId ${episodeId} is not unique in the selected work`
    };
  }
  const selected = upstreamMatches[0];
  if (selected === void 0) {
    return {
      ok: false,
      reason: `The manually selected episodeId ${episodeId} is not present in the selected work`
    };
  }
  const compatibleMatches = resolution.candidates.filter((candidate) => candidate === selected);
  if (compatibleMatches.length !== 1) {
    return {
      ok: false,
      reason: `The manually selected episodeId ${episodeId} is not an identity-compatible candidate`
    };
  }
  return {
    ok: true,
    resolution: {
      ...resolution,
      state: resolution.state === "verified" ? "verified" : "supported",
      selected,
      reason: `The user confirmed identity-compatible danmu episode ${episodeId}`
    }
  };
}
function candidateState(resolution) {
  switch (resolution.state) {
    case "not_found":
      return "candidate-not-found";
    case "conflicting":
      return "candidate-conflict";
    case "uncertain":
      return "candidate-uncertain";
    case "supported":
    case "verified":
      return null;
  }
}
function episodeState(resolution) {
  switch (resolution.state) {
    case "not_found":
      return "episode-not-found";
    case "uncertain":
      return "episode-uncertain";
    case "rejected":
      return "episode-rejected";
    case "supported":
    case "verified":
      return null;
  }
}
var DanmuService = class {
  constructor(dependencies) {
    __publicField(this, "client");
    __publicField(this, "candidateResolver");
    __publicField(this, "episodeResolver");
    this.client = dependencies.client;
    this.candidateResolver = dependencies.candidateResolver ?? new DanmuCandidateResolver();
    this.episodeResolver = dependencies.episodeResolver ?? new DanmuEpisodeResolver();
  }
  async resolve(input) {
    const bindingResult = await this.resolveBinding(input);
    if (bindingResult.binding === null) return bindingResult;
    const comments = await this.client.getComments(bindingResult.binding.danmuEpisodeId, {
      signal: input.signal
    });
    if (!comments.ok) {
      return emptyResult(clientErrorState(comments.error), comments.error.message, {
        binding: bindingResult.binding,
        candidateResolution: bindingResult.candidateResolution,
        episodeResolution: bindingResult.episodeResolution,
        error: comments.error
      });
    }
    if (comments.data.comments.length === 0) {
      return emptyResult("comments-empty", "The resolved danmu episode has no comments", {
        binding: bindingResult.binding,
        candidateResolution: bindingResult.candidateResolution,
        episodeResolution: bindingResult.episodeResolution,
        videoDuration: comments.data.videoDuration
      });
    }
    return {
      state: "success",
      binding: bindingResult.binding,
      comments: comments.data.comments,
      videoDuration: comments.data.videoDuration,
      candidateResolution: bindingResult.candidateResolution,
      episodeResolution: bindingResult.episodeResolution,
      error: null,
      reason: "The canonical episode was bound and its comments were loaded"
    };
  }
  async resolveBinding(input) {
    if (!mediaCanResolve(input)) {
      return emptyResult("media-unresolved", "Canonical media identity is not supported or confirmed");
    }
    const originalInputIssue = episodeInputIssue(input);
    if (originalInputIssue) return emptyResult(originalInputIssue.state, originalInputIssue.reason);
    const manualInputIssue = manualEpisodeInputIssue(input);
    if (manualInputIssue) return emptyResult(manualInputIssue.state, manualInputIssue.reason);
    const canonicalEpisode = input.mediaEpisodes.find(
      (episode) => episode.canonicalEpisodeId === input.episode.canonicalEpisodeId
    );
    if (canonicalEpisode === void 0) {
      return emptyResult("episode-rejected", "The canonical target episode is missing");
    }
    const canonicalInput = { ...input, episode: canonicalEpisode };
    if (!hasReliableEpisodeIdentity(canonicalInput)) {
      return emptyResult("episode-uncertain", "The target episode has no reliable content identity");
    }
    const discovery = await this.discoverCandidates(canonicalInput);
    if (!discovery.ok) {
      return emptyResult(clientErrorState(discovery.error), discovery.error.message, {
        error: discovery.error
      });
    }
    const candidateResolution = this.candidateResolver.resolve(
      input.media,
      discovery.candidates,
      input.manualCandidate === void 0 ? {} : { manualAnimeId: input.manualCandidate.animeId }
    );
    const unresolvedCandidateState = candidateState(candidateResolution);
    if (unresolvedCandidateState) {
      return emptyResult(unresolvedCandidateState, candidateResolution.reason, {
        candidateResolution
      });
    }
    const selectedCandidate = candidateResolution.selected;
    if (selectedCandidate === null || candidateResolution.selectedBy === null) {
      return emptyResult("candidate-uncertain", "Candidate resolution did not select one work", {
        candidateResolution
      });
    }
    const bangumi = await this.client.getBangumi(selectedCandidate.animeId, {
      signal: canonicalInput.signal
    });
    if (!bangumi.ok) {
      return emptyResult(clientErrorState(bangumi.error), bangumi.error.message, {
        candidateResolution,
        error: bangumi.error
      });
    }
    if (bangumi.data.animeId !== selectedCandidate.animeId) {
      const error = {
        kind: "invalid-response",
        status: bangumi.status,
        message: "Bangumi response identity differs from the selected candidate"
      };
      return emptyResult("invalid-response", error.message, {
        candidateResolution,
        error
      });
    }
    let episodeResolution = this.episodeResolver.resolve({
      media: canonicalInput.media,
      targetEpisode: canonicalInput.episode,
      canonicalEpisodes: canonicalInput.mediaEpisodes,
      danmuEpisodes: bangumi.data.episodes
    });
    if (canonicalInput.manualEpisodeId !== void 0) {
      const manualSelection = applyManualEpisodeSelection(
        episodeResolution,
        bangumi.data.episodes,
        canonicalInput.manualEpisodeId
      );
      if (!manualSelection.ok) {
        return emptyResult("episode-rejected", manualSelection.reason, {
          candidateResolution,
          episodeResolution
        });
      }
      episodeResolution = manualSelection.resolution;
    }
    const unresolvedEpisodeState = episodeState(episodeResolution);
    if (unresolvedEpisodeState) {
      return emptyResult(unresolvedEpisodeState, episodeResolution.reason, {
        candidateResolution,
        episodeResolution
      });
    }
    const selectedEpisode = episodeResolution.selected;
    if (selectedEpisode === null) {
      return emptyResult("episode-uncertain", "Episode resolution did not select one episode", {
        candidateResolution,
        episodeResolution
      });
    }
    const mappingState = candidateResolution.state === "verified" && episodeResolution.state === "verified" ? "verified" : "supported";
    const binding = {
      canonicalMediaId: canonicalInput.media.mediaId,
      canonicalEpisodeId: canonicalInput.episode.canonicalEpisodeId,
      danmuAnimeId: selectedCandidate.animeId,
      danmuAnimeTitle: bangumi.data.animeTitle || selectedCandidate.animeTitle,
      danmuEpisodeId: selectedEpisode.episodeId,
      danmuEpisodeTitle: selectedEpisode.episodeTitle,
      mappingState,
      selectedBy: candidateResolution.selectedBy,
      scope: "canonical_episode",
      evidence: [
        {
          stage: "media",
          reason: candidateResolution.reason,
          identityEvidence: candidateResolution.evaluations.find(
            ({ candidate }) => candidate.animeId === selectedCandidate.animeId
          )?.identity.evidence
        },
        {
          stage: "episode",
          reason: episodeResolution.reason,
          episodeEvidence: episodeResolution.evidence
        },
        ...candidateResolution.selectedBy === "manual" ? [{
          stage: "manual",
          reason: canonicalInput.manualEpisodeId === void 0 ? "The user selected the work; the episode was resolved independently" : "The user selected the work and confirmed one identity-compatible danmu episode"
        }] : []
      ]
    };
    return emptyResult(
      mappingState === "verified" ? "binding-verified" : "binding-supported",
      "A canonical-episode-scoped danmaku binding was established",
      { binding, candidateResolution, episodeResolution }
    );
  }
  async discoverCandidates(input) {
    if (input.manualCandidate !== void 0) {
      return { ok: true, candidates: [input.manualCandidate] };
    }
    const matchFileName = reliableMatchFileName(input);
    if (matchFileName !== null) {
      const response2 = await this.client.match(matchFileName, { signal: input.signal });
      if (!response2.ok) return { ok: false, error: response2.error };
      return {
        ok: true,
        candidates: response2.data.isMatched ? response2.data.matches.map(adaptDanmuMatchCandidate) : []
      };
    }
    const response = await this.client.searchAnime(input.media.canonicalTitle, {
      signal: input.signal
    });
    if (!response.ok) return { ok: false, error: response.error };
    return { ok: true, candidates: response.data.animes.map(adaptDanmuSearchAnime) };
  }
};

// src/core/danmaku/danmu-playback-adapter.ts
function stringValue3(value) {
  return value === null || value === void 0 ? "" : String(value);
}
function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
function mediaScopeId(input) {
  return `playback-media:${stableHash(`${input.sourceKey}\0${input.vodId}\0${input.rawTitle}`)}`;
}
function partKey(value) {
  return value === null ? "-" : String(value);
}
function reliableSemanticKey(parsed, mediaSeason) {
  if (parsed.confidence !== "high" || parsed.ambiguous) return null;
  if (parsed.airDate !== null) {
    return `date:${parsed.airDate}:part:${partKey(parsed.part)}`;
  }
  if (parsed.contentType === "regular" && parsed.episodeNumber !== null) {
    const season = parsed.seasonNumber ?? mediaSeason;
    return [
      parsed.numberKind,
      `season:${season ?? "-"}`,
      `episode:${parsed.episodeNumber}`,
      `absolute:${parsed.absoluteNumber ?? "-"}`,
      `part:${partKey(parsed.part)}`
    ].join(":");
  }
  if (parsed.contentType === "special" && parsed.specialKind !== null && parsed.specialNumber !== null) {
    return `special:${parsed.specialKind}:${parsed.specialNumber}:part:${partKey(parsed.part)}`;
  }
  if (parsed.contentType === "movie") return "movie:main-feature";
  return null;
}
function mediaEvidence(rawTitle, canonicalTitle, releaseYear, season) {
  const evidence = [{
    field: "title",
    state: canonicalTitle ? "supporting" : "unknown",
    reason: canonicalTitle ? "The current playback title defines the local canonical media scope" : "The current playback item has no usable title",
    leftValue: rawTitle,
    rightValue: canonicalTitle || null,
    source: "danmaku-playback-adapter"
  }];
  if (releaseYear !== null) {
    evidence.push({
      field: "year",
      state: "supporting",
      reason: "The source supplied an explicit release year",
      leftValue: releaseYear,
      rightValue: releaseYear,
      source: "danmaku-playback-adapter"
    });
  }
  if (season !== null) {
    evidence.push({
      field: "season",
      state: "supporting",
      reason: "The shared title parser found an explicit season marker",
      leftValue: season,
      rightValue: season,
      source: "danmaku-playback-adapter"
    });
  }
  return evidence;
}
function rawRecord(input) {
  const rawPlayFrom = input.playGroup ?? input.sourceName ?? input.sourceKey;
  const rawPlayUrl = input.episodes.map((episode) => episode.rawEntry ?? `${episode.name}$${episode.url}`).join("#");
  return {
    ...input.rawData ?? {},
    vod_id: input.vodId,
    vod_name: input.rawTitle,
    vod_year: stringValue3(input.rawYear),
    vod_remarks: stringValue3(input.rawRemarks),
    type_name: stringValue3(input.rawCategory),
    vod_director: stringValue3(input.rawDirector),
    vod_actor: stringValue3(input.rawActors),
    vod_area: stringValue3(input.rawArea),
    vod_lang: stringValue3(input.rawLanguage),
    vod_content: stringValue3(input.rawDescription),
    vod_pic: stringValue3(input.rawCover),
    vod_play_from: rawPlayFrom,
    vod_play_url: rawPlayUrl
  };
}
function unresolvedEpisodeId(mediaId, rawName, occurrence) {
  return `${mediaId}:unresolved:${stableHash(rawName)}:${occurrence}`;
}
function createDanmakuPlaybackContext(input) {
  const normalized = SourceNormalizer.normalize(rawRecord(input), {
    sourceKey: input.sourceKey,
    sourceName: input.sourceName,
    fetchedAt: input.fetchedAt
  });
  const parsedTitle = parseTitle(normalized.rawTitle);
  const canonicalTitle = parsedTitle.baseTitle.trim();
  const releaseYear = normalized.parsedYear ?? parsedTitle.year;
  const mediaSeason = normalized.parsedSeason;
  const mediaId = mediaScopeId(input);
  const playGroupIndex = input.playGroupIndex ?? 0;
  const playGroup = input.playGroup ?? input.sourceName ?? input.sourceKey;
  const drafts = input.episodes.map((episode2) => {
    const parsed = parseEpisode(episode2.name, { mediaType: normalized.mediaType });
    return {
      input: episode2,
      parsed,
      semanticKey: reliableSemanticKey(parsed, mediaSeason),
      seasonConflict: mediaSeason !== null && parsed.seasonNumber !== null && mediaSeason !== parsed.seasonNumber
    };
  });
  const semanticCounts = /* @__PURE__ */ new Map();
  for (const draft of drafts) {
    if (draft.semanticKey !== null) {
      semanticCounts.set(draft.semanticKey, (semanticCounts.get(draft.semanticKey) ?? 0) + 1);
    }
  }
  const unresolvedOccurrences = /* @__PURE__ */ new Map();
  const canonicalEpisodes = [];
  const sourceEpisodes = [];
  for (const draft of drafts) {
    const duplicateIdentity = draft.semanticKey !== null && (semanticCounts.get(draft.semanticKey) ?? 0) > 1;
    const mapped = draft.semanticKey !== null && !draft.seasonConflict && !duplicateIdentity;
    const rawName = String(draft.input.name ?? "");
    const occurrence = unresolvedOccurrences.get(rawName) ?? 0;
    unresolvedOccurrences.set(rawName, occurrence + 1);
    const canonicalEpisodeId = draft.semanticKey === null ? unresolvedEpisodeId(mediaId, rawName, occurrence) : `${mediaId}:episode:${encodeURIComponent(draft.semanticKey)}`;
    const canonicalSeason = draft.parsed.seasonNumber ?? (draft.parsed.contentType === "regular" ? mediaSeason : null);
    const rawEntry = draft.input.rawEntry ?? `${rawName}$${draft.input.url}`;
    canonicalEpisodes.push({
      canonicalEpisodeId,
      mediaId,
      contentType: draft.parsed.contentType,
      seasonNumber: canonicalSeason,
      episodeNumber: draft.parsed.episodeNumber,
      absoluteNumber: draft.parsed.absoluteNumber,
      airDate: draft.parsed.airDate,
      episodeTitle: rawName.trim() || null,
      part: draft.parsed.part,
      identityState: mapped ? "supported" : "uncertain",
      evidence: []
    });
    let mappingState = "unmapped";
    let mappingEvidence = [
      "No reliable semantic episode identity was parsed; rawIndex was not used as a fallback"
    ];
    if (draft.seasonConflict) {
      mappingState = "conflicting";
      mappingEvidence = [
        `Explicit episode season ${draft.parsed.seasonNumber} conflicts with media season ${mediaSeason}`
      ];
    } else if (duplicateIdentity) {
      mappingState = "conflicting";
      mappingEvidence = [
        "The same semantic episode identity occurs more than once in this playback list"
      ];
    } else if (mapped) {
      mappingState = "mapped";
      mappingEvidence = [
        `Mapped from reliable parsed episode identity ${draft.semanticKey}`
      ];
    }
    sourceEpisodes.push({
      sourceKey: input.sourceKey,
      vodId: input.vodId,
      playGroup,
      playGroupIndex,
      rawIndex: draft.input.rawIndex,
      rawEpisodeName: rawName,
      displayName: rawName.trim() || "\u672A\u547D\u540D\u64AD\u653E\u9879",
      rawEntry,
      playUrl: draft.input.url,
      parsedEpisodeInfo: draft.parsed,
      canonicalEpisodeId: mapped ? canonicalEpisodeId : null,
      mappingState,
      mappingEvidence
    });
  }
  const sourcePlayGroup = {
    sourceKey: input.sourceKey,
    vodId: input.vodId,
    rawIndex: playGroupIndex,
    rawName: playGroup,
    displayName: playGroup,
    rawValue: input.episodes.map((episode2) => episode2.rawEntry ?? `${episode2.name}$${episode2.url}`).join("#"),
    episodes: sourceEpisodes
  };
  const sourceRecord = {
    ...normalized,
    playGroups: sourceEpisodes.length > 0 ? [sourcePlayGroup] : []
  };
  const media = {
    mediaId,
    mediaType: normalized.mediaType,
    canonicalTitle,
    aliases: parsedTitle.aliases,
    releaseYear,
    season: mediaSeason,
    directors: normalized.normalizedDirector,
    actors: normalized.normalizedActors,
    externalIds: {},
    evidence: mediaEvidence(normalized.rawTitle, canonicalTitle, releaseYear, mediaSeason),
    identityState: canonicalTitle ? "supported" : "uncertain",
    episodes: canonicalEpisodes
  };
  const currentMatches = [];
  sourceEpisodes.forEach((episode2, index) => {
    if (episode2.rawIndex === input.currentEpisodeIndex) currentMatches.push(index);
  });
  if (currentMatches.length !== 1) {
    return {
      state: "invalid",
      reason: currentMatches.length === 0 ? "The current raw playback coordinate is absent from the source sequence" : "The current raw playback coordinate occurs more than once in the source sequence",
      sourceRecord,
      media,
      mediaEpisodes: canonicalEpisodes,
      sourceEpisodes,
      episode: null,
      sourceEpisode: null,
      currentEpisodeIndex: input.currentEpisodeIndex
    };
  }
  const currentPosition = currentMatches[0];
  if (currentPosition === void 0) {
    return {
      state: "invalid",
      reason: "The current raw playback coordinate could not be selected",
      sourceRecord,
      media,
      mediaEpisodes: canonicalEpisodes,
      sourceEpisodes,
      episode: null,
      sourceEpisode: null,
      currentEpisodeIndex: input.currentEpisodeIndex
    };
  }
  const sourceEpisode = sourceEpisodes[currentPosition] ?? null;
  const episode = canonicalEpisodes[currentPosition] ?? null;
  if (sourceEpisode === null || episode === null) {
    return {
      state: "invalid",
      reason: "The selected source and canonical episode sequences are inconsistent",
      sourceRecord,
      media,
      mediaEpisodes: canonicalEpisodes,
      sourceEpisodes,
      episode: null,
      sourceEpisode: null,
      currentEpisodeIndex: input.currentEpisodeIndex
    };
  }
  const ready = media.identityState === "supported" && sourceEpisode.mappingState === "mapped" && episode.identityState === "supported";
  return {
    state: ready ? "ready" : "uncertain",
    reason: ready ? "The playback work and current episode have reliable Core V2 identities" : sourceEpisode.mappingEvidence.join("; "),
    sourceRecord,
    media,
    mediaEpisodes: canonicalEpisodes,
    sourceEpisodes,
    episode,
    sourceEpisode,
    currentEpisodeIndex: input.currentEpisodeIndex
  };
}

// src/core/index.ts
var LibertyCore = Object.freeze({
  SourceError,
  TitleParser,
  parseTitle,
  CandidateEvidenceCollector,
  collectCandidateEvidence,
  DEFAULT_IDENTITY_POLICY,
  EntityResolver,
  resolveEntityIdentity,
  EpisodeParser,
  parseEpisode,
  EpisodeAligner,
  alignEpisodeSequences,
  EpisodeResolver,
  resolveEpisode,
  SourceNormalizer,
  parseAppleCmsPlaySources,
  AppleCMSAdapter,
  SourceManager,
  DanmuClient,
  DanmuCandidateResolver,
  adaptDanmakuCandidate,
  adaptDanmuSearchAnime,
  resolveDanmakuCandidate,
  DanmuEpisodeResolver,
  resolveDanmakuEpisode,
  DanmuService,
  createDanmakuPlaybackContext
});
if (typeof window !== "undefined") {
  window.LibertyCore = LibertyCore;
}
export {
  AppleCMSAdapter,
  CandidateEvidenceCollector,
  DEFAULT_IDENTITY_POLICY,
  DanmuCandidateResolver,
  DanmuClient,
  DanmuEpisodeResolver,
  DanmuService,
  EntityResolver,
  EpisodeAligner,
  EpisodeParser,
  EpisodeResolver,
  LibertyCore,
  SourceError,
  SourceManager,
  SourceNormalizer,
  TitleParser,
  adaptDanmakuCandidate,
  adaptDanmuSearchAnime,
  alignEpisodeSequences,
  collectCandidateEvidence,
  createDanmakuPlaybackContext,
  parseAppleCmsPlaySources,
  parseEpisode,
  parseTitle,
  resolveDanmakuCandidate,
  resolveDanmakuEpisode,
  resolveEntityIdentity,
  resolveEpisode
};
//# sourceMappingURL=liberty-core.js.map
