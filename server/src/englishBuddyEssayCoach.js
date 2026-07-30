/**
 * Essay coaching hints for Virtual Mr. Park — no strikes, freezes, or soft offenses.
 * Abuse guard lives in englishBuddyAbuseService.js.
 */

const LAZY_KEYWORD_RES = [
  /\bi\s*don'?t\s*know\b/i,
  /\bi\s*dont\s*know\b/i,
  /\bdunno\b/i,
  /\bidk\b/i,
  /\byou\s+do\s+it\b/i,
  /\bjust\s+tell\s+me\b/i
];

const SHORT_LAZY_RE =
  /^(i\s*don'?t\s*know|i\s*dont\s*know|idk|dunno|yes|no|yep|nope|yeah|nah+|bruh+|meh|idc|nvm|whatever|[123]|[.!?…]+)$/i;

const STEP_ADVANCE_NUDGE =
  'Student wants next Salt Academy essay step. Accept in one short line and help at THAT step (Hook→Bridge→Thesis→PEEL body→Conclusion). No redo. No ghostwriting. Body paragraphs: aim ~6–7 sentences via PEEL, gradually.';

function msgText(m) {
  return String((m && (m.text != null ? m.text : m.content)) || '').trim();
}

function normalizeBuddyText(text) {
  return String(text || '')
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeIdkFriendlyText(text) {
  let t = normalizeBuddyText(text).toLowerCase();
  t = t.replace(/\bdon\s*[\[\(\{`'"]+\s*t\b/g, "don't");
  t = t.replace(/\bcan\s*[\[\(\{`'"]+\s*t\b/g, "can't");
  t = t.replace(/\bdno'?t\b/g, "don't");
  t = t.replace(/\bodn'?t\b/g, "don't");
  t = t.replace(/\bdon'?tk\b/g, 'dont');
  t = t.replace(/\bdontk\b/g, 'dont');
  t = t.replace(/\bdnot\b/g, 'dont');
  t = t.replace(/\bdon\s*t\b/g, 'dont');
  t = t.replace(/\bcan\s*t\b/g, 'cant');
  t = t.replace(/\bonw\b/g, 'know');
  t = t.replace(/\bknwo\b/g, 'know');
  t = t.replace(/\bkonw\b/g, 'know');
  t = t.replace(/\bnkow\b/g, 'know');
  t = t.replace(/\bkwnow\b/g, 'know');
  t = t.replace(/[\[\]\{\}]/g, '');
  t = t.replace(/[^a-z0-9가-힣'\s]+/gi, ' ').replace(/\s+/g, ' ').trim();
  return t;
}

function collapseLetterElongation(text) {
  return String(text || '').replace(/(.)\1{2,}/g, '$1$1');
}

function isHelpSeekingMessage(text) {
  const lower = normalizeBuddyText(text).toLowerCase();
  if (!lower) return false;
  if (/\b(hint|hints|clue|clues|tip|tips)\b/.test(lower)) return true;
  if (/\b(remind|reminder|jog\s+my\s+memory)\b/.test(lower)) return true;
  if (/(힌트|기억\s*안|잘\s*기억|생각\s*안|도와줘|도와\s*줄래|알려줄|알려줘|가르쳐)/.test(lower)) {
    return true;
  }
  if (/\b(can|could|would)\s+you\s+(give|help|tell|show|remind)/.test(lower)) return true;
  if (
    /\bgive\s+me\s+(a\s+|some\s+|an\s+)?(hint|hints|clue|clues|tip|tips|example|examples|idea|ideas|keyword|keywords)\b/.test(
      lower
    )
  ) {
    return true;
  }
  if (/\bhelp\s+me\s+(remember|think|figure|brainstorm|with)\b/.test(lower)) return true;
  if (/\bwhat\s+(are|were)\s+(some|the)\s+(options|ideas|keywords)\b/.test(lower)) return true;
  if (
    /\b(maybe|perhaps|i\s+think|probably)\b/.test(lower) &&
    lower.split(/\s+/).filter(Boolean).length >= 5
  ) {
    return true;
  }
  return false;
}

function isIdkMessage(text) {
  if (isHelpSeekingMessage(text)) {
    const lower = normalizeBuddyText(text).toLowerCase();
    if (/^(help(\s+me)?|help\s+me\s+please)([.!?\s~]*)$/i.test(lower)) return true;
    return false;
  }
  const raw = normalizeBuddyText(text);
  if (!raw) return false;
  const lower = collapseLetterElongation(normalizeIdkFriendlyText(raw));

  if (
    /^(몰라요+|몰라여|몰라요|몰라|모르겠(어요|어|다)?|모름|글쎄(요)?|잘\s*모르(겠)?(어요|어)?)([~.!?\sㅋㅎㅎ]*)$/u.test(raw)
  ) {
    return true;
  }
  if (/(몰라요|모르겠|모름|잘\s*몰라)/u.test(raw) && raw.length <= 28) return true;

  if (/^(i\s*don'?t\s*know|i\s*dont\s*know|i\s*do\s*not\s*know|idk|dunno)([~.!?\sㅋㅎ]*)$/i.test(lower)) {
    return true;
  }
  if (
    /^(i\s*can'?t\s*remember|i\s*cant\s*remember|i\s*forgot|no\s*idea|not\s*sure|i\s*have\s*no\s*idea)([~.!?\s]*)$/i.test(
      lower
    )
  ) {
    return true;
  }
  if (/^(i\s+)?(really\s+|just\s+|still\s+)?(don'?t|dont)\s*know\b/i.test(lower) && lower.length <= 64) {
    return true;
  }
  if (/^(i\s+)?(really\s+|just\s+|still\s+)?do\s+not\s+know\b/i.test(lower) && lower.length <= 64) {
    return true;
  }
  if (/\bi\s*don'?t\s*know\b/i.test(lower) && lower.length <= 64) return true;
  if (/\bi\s*dont\s*know\b/i.test(lower) && lower.length <= 64) return true;
  if (/\bi\s*do\s*not\s*know\b/i.test(lower) && lower.length <= 64) return true;
  if (/\bi\s*can'?t\s*remember\b/i.test(lower) && lower.length <= 56) return true;
  if (/\b(i\s+have\s+)?no\s*idea\b/i.test(lower) && lower.length <= 48) return true;
  if (/^(i\s+)?dunno\b/i.test(lower) && lower.length <= 40) return true;
  if (/^(idk|dunno)([,.!]?\s+.*)?$/i.test(lower) && lower.length <= 40) return true;
  if (/\byou\s+choose\b/i.test(lower) && lower.length <= 40) return true;
  if (/^(help(\s+me)?|help\s+me\s+please)([.!?\s~]*)$/i.test(lower)) return true;
  return false;
}

function isStepAdvanceRequest(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 160) return false;
  const lower = t.toLowerCase();
  if (
    /i'?ll take (that|it|this)/i.test(lower) ||
    /thanks for writing/i.test(lower) ||
    /you (wrote|write) it/i.test(lower)
  ) {
    return false;
  }
  if (
    /\b(next(\s+(one|step|part|section))?|move\s+on|skip(\s+to)?|go\s+(to|ahead)|let'?s\s+go)\b/i.test(
      lower
    )
  ) {
    return true;
  }
  if (
    /\b(i('?m|\s+am)\s+done|already\s+wrote|finished(\s+(it|that|this|hook|bridge|thesis|intro|body))?|that'?s\s+enough)\b/i.test(
      lower
    )
  ) {
    return true;
  }
  if (
    /(지금은\s*됐고|다음\s*(거|것|스텝|단계|문단|파트)|넘어가|스킵|다음으로)/.test(t)
  ) {
    return true;
  }
  if (
    /\b(body(\s*(paragraph)?\s*[123]?)|conclusion|bridge|thesis|hook|fancy\s*words|peel|rss)\b/i.test(
      lower
    ) &&
    /\b(next|go\s+to|skip|do|write|start|let'?s)\b/i.test(lower)
  ) {
    return true;
  }
  return false;
}

function isAcknowledgmentMessage(text) {
  const t = normalizeBuddyText(text);
  if (!t) return false;
  return /^(ok|okay|k|kk|yes|yeah|yep|yup|sure|alright|all right|got it|okay then|ok then|fine|cool)([!.?\s]*)$/i.test(
    t
  );
}

function hasLazyKeyword(text) {
  return LAZY_KEYWORD_RES.some(function(re) {
    return re.test(String(text || ''));
  });
}

function isShortLazyAnswer(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (isAcknowledgmentMessage(t)) return false;
  if (isStepAdvanceRequest(t)) return false;
  if (/^[123]$/.test(t)) return true;
  if (SHORT_LAZY_RE.test(t)) return true;
  if (hasLazyKeyword(t) && t.length <= 24) return true;
  return false;
}

function lastAssistantText(history) {
  const hist = Array.isArray(history) ? history : [];
  for (let i = hist.length - 1; i >= 0; i--) {
    if (String((hist[i] && hist[i].role) || '') === 'assistant') {
      return msgText(hist[i]);
    }
  }
  return '';
}

function lastUserTextBeforeCurrent(history) {
  const hist = Array.isArray(history) ? history : [];
  for (let i = hist.length - 1; i >= 0; i--) {
    if (String((hist[i] && hist[i].role) || '') === 'user') {
      return msgText(hist[i]);
    }
  }
  return '';
}

function isContextualNumberPick(history, text) {
  const t = normalizeBuddyText(text);
  if (!/^[1-5]$/.test(t)) return false;
  const lastAsst = lastAssistantText(history);
  if (!lastAsst) return false;
  if (
    /\b(pick|choose|option|try this|which one|which|angle|topic|sound good|any of these|ideas like|fancy words?|style|hook|bridge|thesis)\b/i.test(
      lastAsst
    )
  ) {
    return true;
  }
  if (/(^|\n)\s*\*{0,2}1[\.\)\:]/m.test(lastAsst) && /(^|\n)\s*\*{0,2}2[\.\)\:]/m.test(lastAsst)) {
    return true;
  }
  return false;
}

function isOverhelpProtest(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  return (
    /literally\s+copied/.test(t) ||
    /exactly\s+(the\s+)?same\s+as\s+what\s+you/.test(t) ||
    /isn'?t\s+that\s+exactly/.test(t) ||
    /you\s+just\s+told\s+me/.test(t) ||
    /copied\s+yours/.test(t) ||
    /what\s+you\s+(just\s+)?(told|gave|wrote)/.test(t) ||
    /took\s+all\s+your\s+idea/.test(t) ||
    /did\s+not\s+use\s+any\s+of\s+my\s+brain/.test(t) ||
    /didn'?t\s+use\s+(any\s+of\s+)?my\s+brain/.test(t) ||
    /you'?re\s+not\s+supposed\s+to/.test(t) ||
    /not\s+supposed\s+to\s+do\s+this/.test(t) ||
    /gave\s+me\s+too\s+much/.test(t) ||
    /too\s+much\s+help/.test(t) ||
    /you just gave me a correction/.test(t) ||
    /just gave me a correction/.test(t) ||
    /that was (just )?(a )?correction/.test(t) ||
    /huh\??\s*you just/.test(t)
  );
}

function significantWords(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9가-힣']+/i)
    .filter(function(w) {
      return w.length >= 4 && !/^(that|this|with|from|have|help|make|made|they|them|your|about|would|could|should|very|just|like|been|were|what|when|then|than|also|into)$/i.test(w);
    });
}

function wordOverlapCount(a, b) {
  const wa = significantWords(a);
  const setB = {};
  significantWords(b).forEach(function(w) { setB[w] = true; });
  let n = 0;
  wa.forEach(function(w) { if (setB[w]) n += 1; });
  return n;
}

function hasCorrectionLanguage(asst) {
  return /\b(correct|correction|clearer|fix|grammar|we (usually )?say|how about|almost|small (fix|correction)|try:|better:|locked in)\b/i.test(
    String(asst || '')
  );
}

function looksLikeGrammarCorrectionTurn(history) {
  const prevUser = lastUserTextBeforeCurrent(history);
  const lastAsst = lastAssistantText(history);
  if (!prevUser || prevUser.length < 6 || !lastAsst) return false;
  if (!hasCorrectionLanguage(lastAsst) && !/\*\*[^*]{8,}\*\*/.test(lastAsst)) return false;
  const overlap = wordOverlapCount(prevUser, lastAsst);
  if (overlap >= 1) return true;
  return prevUser.split(/\s+/).filter(Boolean).length <= 14;
}

function isAcceptingCorrection(history, userText) {
  if (!looksLikeGrammarCorrectionTurn(history)) return false;
  const t = String(userText || '').trim();
  const lower = t.toLowerCase();
  const lastAsst = lastAssistantText(history);
  const prevUser = lastUserTextBeforeCurrent(history);
  const asstLower = String(lastAsst || '').toLowerCase();

  if (
    /^(ok|okay|sounds good|got it|yes|yep|sure)([.!?\s]*)$/i.test(t) ||
    /i'?ll take (that|it|this|your (idea|sentence|correction|fix))/i.test(lower) ||
    /sounds good.*i'?ll take/i.test(lower) ||
    /okay sounds good/i.test(lower)
  ) {
    return true;
  }

  if (t.length >= 12 && asstLower.indexOf(lower.replace(/[.!?]+$/, '')) >= 0) {
    return true;
  }
  const stripped = lower.replace(/^(ok|okay|sure|yes)[,.]?\s+/i, '').replace(/[.!?]+$/, '');
  if (stripped.length >= 12 && asstLower.indexOf(stripped) >= 0) {
    return true;
  }
  if (t.length >= 10 && wordOverlapCount(prevUser, t) >= 1) {
    return true;
  }

  return false;
}

function historyLooksLikeEssayCoaching(history) {
  const blob = (Array.isArray(history) ? history : [])
    .slice(-10)
    .map(msgText)
    .join(' ');
  return /\b(hook|bridge|thesis|essay|peel|salt|fancy\s*words|introduction|brainstorm|paragraph|conclusion|complete this|write (your|a)|full sentence|5-paragraph|angle|topic)\b/i.test(
    blob
  );
}

function lastAssistantOfferedNumberedReadySentences(asst) {
  const t = String(asst || '');
  if (!t) return false;
  const lines = t.split(/\n+/);
  let finished = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const m = line.match(/^\*{0,2}\s*[1-5][\.\)\:]\s*\*{0,2}\s*[`"']?(.+?)[`"']?\s*$/);
    if (!m) continue;
    const body = String(m[1] || '')
      .replace(/^\*{1,2}|\*{1,2}$/g, '')
      .trim();
    if (/\[[^\]]+\]/.test(body)) continue;
    const words = body.split(/\s+/).filter(Boolean);
    if (words.length >= 6 && /[.!?]"?$/.test(body)) finished += 1;
  }
  return finished >= 2;
}

function lastAssistantOfferedFinishedSentence(asst) {
  const t = String(asst || '');
  if (!t) return false;
  if (/how about:\s*[`"']?[A-Za-z][^`"'\n]{25,}[.!?]/i.test(t)) return true;
  if (/locked in![^`]*`[^`]{25,}`/i.test(t)) return true;
  if (lastAssistantOfferedNumberedReadySentences(t)) return true;
  const ticks = t.match(/`([^`]+)`/g) || [];
  for (let i = 0; i < ticks.length; i++) {
    const inner = ticks[i].slice(1, -1).trim();
    if (/\[[^\]]+\]/.test(inner)) continue;
    const words = inner.split(/\s+/).filter(Boolean);
    if (words.length >= 6 && /[.!?]$/.test(inner)) return true;
  }
  return false;
}

function detectEssayProcessNudge(history, userText) {
  const t = String(userText || '').trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  const lastAsst = lastAssistantText(history);
  const essayCtx =
    historyLooksLikeEssayCoaching(history) ||
    /\b(essay|brainstorm|hook|bridge|thesis|peel|paragraph|pollution|global\s+warming|body\s+paragraph|salt)\b/i.test(
      lower + ' ' + String(lastAsst || '')
    );
  if (!essayCtx) return null;

  const offeredChoices =
    !!lastAsst &&
    /\b(1[\).:]|option\s*1|which one|keywords?|brainstorm|body)\b/i.test(lastAsst) &&
    /\b(2[\).:]|3[\).:])\b/.test(lastAsst);

  if (
    offeredChoices &&
    (/\b(everything|all\s+(of\s+them|three|3)|all\s+sound|both)\b/i.test(lower) ||
      /^(oh\s+)?(everything|all)(\s+sounds?\s+good)?([.!?\s]*)$/i.test(lower) ||
      /\bi\s+(like|want|choose)\s+(all|everything)\b/i.test(lower))
  ) {
    return { kind: 'BRAINSTORM_ACCEPT_ALL' };
  }

  if (
    /\b(already\??|not\s+even\s+finish|didn'?t\s+(even\s+)?(finish|choose)|still\s+(choosing|picking)|only\s+(a\s+)?(topic\s+for\s+)?(a\s+)?body|body\s+paragraph|main\s+focus|go\s+back|too\s+fast|wait)\b/i.test(
      lower
    ) ||
    /\b(how\s+to\s+stop|our\s+main\s+(topic|focus)|essay\s+topic)\b/i.test(lower) ||
    /huh\??\s*already/i.test(lower)
  ) {
    return { kind: 'BRAINSTORM_NOT_DONE' };
  }

  if (
    !!lastAsst &&
    /\b(topic|write about|essay about|what (do you|should we) (write|choose))\b/i.test(lastAsst) &&
    /^(animals?|sports?|food|school|friends?|family|games?|music|movies?|life|world|earth|nature|technology|people|kids?|students?)([.!?\s]*)$/i.test(
      lower
    )
  ) {
    return { kind: 'TOPIC_NARROW' };
  }

  if (
    !!lastAsst &&
    /\b(PEEL|point|evidence|explanation|link|body\s*(paragraph)?\s*[123]?)\b/i.test(lastAsst) &&
    /\b(done|finished|next|that'?s\s+it|short\s+is\s+ok)\b/i.test(lower) &&
    !isStepAdvanceRequest(t)
  ) {
    return { kind: 'BODY_LENGTH' };
  }

  return null;
}

/** Coach-only laziness/copy signals — never returns LAZY (abuse handles that). */
function detectEssayLaziness(history, userText) {
  const t = String(userText || '').trim();
  const lower = t.toLowerCase();
  const lastAsst = lastAssistantText(history);
  let kind = null;

  if (isStepAdvanceRequest(t)) return null;
  if (isIdkMessage(t)) return null;

  if (/^[1-5]$/.test(t) && lastAssistantOfferedNumberedReadySentences(lastAsst)) {
    kind = 'GHOSTWRITE_ACCEPT';
  } else if (isContextualNumberPick(history, t)) {
    return null;
  } else if (isAcceptingCorrection(history, t)) {
    kind = 'ACCEPT_CORRECTION';
  } else if (isOverhelpProtest(t)) {
    kind = 'OVERHELP_PROTEST';
  } else if (
    lastAssistantOfferedFinishedSentence(lastAsst) &&
    /^(ok|okay|k|kk|yes|yep|yup|sure|good|sounds good|fine|cool|nice|perfect|locked in)([.!?\s]*)$/i.test(
      lower
    )
  ) {
    kind = 'GHOSTWRITE_ACCEPT';
  } else if (
    /i'?ll take (that|it|this)/i.test(lower) ||
    /thanks for writing/i.test(lower) ||
    /thank you for writing/i.test(lower) ||
    /you (wrote|write) it( down)?( for me)?/i.test(lower) ||
    /sounds good.*choose/i.test(lower) ||
    (/oh thanks/i.test(lower) && /take|use|choose|that/i.test(lower)) ||
    (/okay sounds good/i.test(lower) && /take|idea|sentence/i.test(lower))
  ) {
    kind = 'COPYING';
  } else if (
    /^[123]$/.test(t) &&
    /\b(pick|choose|option|try this|1\)|2\)|3\))/i.test(lastAsst) &&
    /(\[[^\]]*\]|complete this|type (it|the|your)|full sentence|write (your|a|the)|hook|bridge|thesis)/i.test(
      lastAsst
    )
  ) {
    kind = 'NUMBER_ONLY';
  } else if (
    lastAsst &&
    t.length >= 25 &&
    !isShortLazyAnswer(t) &&
    lastAsst.toLowerCase().indexOf(lower.slice(0, Math.min(40, lower.length))) >= 0
  ) {
    kind = 'ECHO';
  }

  if (!kind) return null;
  return {
    kind: kind,
    sampleText: t.slice(0, 160),
    lastAssistantSnippet: String(lastAsst || '').slice(0, 120)
  };
}

function buildEssayCoachNudge(kind) {
  if (kind === 'STEP_ADVANCE') {
    return STEP_ADVANCE_NUDGE;
  }
  if (kind === 'ACCEPT_CORRECTION') {
    return 'They accepted a grammar fix of THEIR idea. Say "Locked in!" and move on. No "your own words" loop.';
  }
  if (kind === 'OVERHELP_PROTEST') {
    return 'They say you over-helped. Admit briefly, ask one tiny question, move on. No Warning text.';
  }
  if (kind === 'COPYING' || kind === 'ECHO') {
    return (
      'They keep copying YOUR ideas/sentences. Firm Mr. Park: make THEM type their own with a [bracket] frame. ' +
      'NEVER write a finished ready-to-copy sentence. No ghostwriting. No Warning text.'
    );
  }
  if (kind === 'COPYING_WARN') {
    return (
      'Copying / "I\'ll take yours" attitude — warm but firm: invent their OWN words with a [bracket] frame. ' +
      'No finished sentence from you. No Warning text.'
    );
  }
  if (kind === 'GHOSTWRITE_ACCEPT') {
    return (
      'CRITICAL: You offered finished ready-to-copy sentence(s) (or a numbered list of full sentences) and they picked/accepted one. ' +
      'Do NOT lock it in or ask them to retype YOUR sentence. Apologize briefly, give keywords or an EMPTY [bracket] frame only, ' +
      'and make THEM invent their own line. No ghostwriting. No Warning text.'
    );
  }
  if (kind === 'NUMBER_ONLY') {
    return (
      'They only picked a number. If choosing brainstorm/fancy-word keywords: accept and continue. ' +
      'If Hook/Bridge/Thesis: "Great choice! Now type your full sentence." Give a [bracket] frame if stuck — ' +
      'NEVER a finished sentence. No Warning text.'
    );
  }
  if (kind === 'IDK_L1') {
    return (
      'HELP LADDER LEVEL 1. 2–3 short keywords/angles only. No full sentences. Firm but warm: try ONE English idea. ' +
      'No Warning text in chat.'
    );
  }
  if (kind === 'IDK_L2') {
    return (
      'HELP LADDER LEVEL 2. One simple question only. Do NOT write their Hook/Bridge/Thesis. ' +
      'No Warning text in chat.'
    );
  }
  if (kind === 'IDK_L3') {
    return (
      'HELP LADDER LEVEL 3. Bracket frame with EMPTY blanks only, e.g. `Global warming is a [big/serious] problem that [does what?].` ' +
      'Tell them to TYPE it. NEVER fill in the blanks yourself. No Warning text in chat.'
    );
  }
  if (kind === 'BRAINSTORM_ACCEPT_ALL') {
    return (
      'BRAINSTORM: they accepted ALL keyword options. Lock all three as Body 1/2/3, list keywords, ' +
      'keep essay TOPIC fixed, then Intro Hook (separate from Bridge/Thesis). Keywords only — no ghostwriting.'
    );
  }
  if (kind === 'BRAINSTORM_NOT_DONE') {
    return (
      'Student says brainstorm is unfinished or one idea is only a BODY point. Agree briefly. ' +
      'Return to BRAINSTORM; lock 3 body ideas before Hook. Soft keyword hints OK ("If I were you…"). No scolding.'
    );
  }
  if (kind === 'TOPIC_NARROW') {
    return (
      'Topic is too broad. Help them pick a clearer side / more specific topic before 3 body ideas. ' +
      'Short options as keywords only. No ghostwriting.'
    );
  }
  if (kind === 'BODY_LENGTH') {
    return (
      'Guide PEEL so this body paragraph builds toward about 6–7 sentences. One PEEL piece at a time. ' +
      'Never dump a finished paragraph. No Warning text.'
    );
  }
  return '';
}

function getEssayCoachHint(history, userText) {
  if (isStepAdvanceRequest(userText)) {
    return {
      stepAdvance: true,
      coachingNudge: buildEssayCoachNudge('STEP_ADVANCE'),
      kind: 'STEP_ADVANCE'
    };
  }

  const essayProcess = detectEssayProcessNudge(history, userText);
  if (essayProcess) {
    return {
      stepAdvance: false,
      coachingNudge: buildEssayCoachNudge(essayProcess.kind),
      kind: essayProcess.kind
    };
  }

  const essayLazy = detectEssayLaziness(history, userText);
  if (essayLazy) {
    return {
      stepAdvance: false,
      coachingNudge: buildEssayCoachNudge(essayLazy.kind),
      kind: essayLazy.kind
    };
  }

  return {
    stepAdvance: false,
    coachingNudge: '',
    kind: null
  };
}

module.exports = {
  isStepAdvanceRequest,
  getEssayCoachHint
};
